import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL("../../../supabase/migrations/152_location_intake_identity.sql", import.meta.url));
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

const PROPOSAL_COLUMNS = [
  "partner_pickup_location_proposal",
  "partner_dropoff_location_proposal",
];

function quotedColumn(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function proposalConstraintGuard(column) {
  const constraintName = `chk_transportation_requests_${column}`;
  const constraintLookup = migration.indexOf(`conname = '${constraintName}'`);
  if (constraintLookup < 0) return "";
  const blockStart = migration.lastIndexOf("DO $$", constraintLookup);
  const blockEnd = migration.indexOf("END $$;", constraintLookup);
  return blockStart < 0 || blockEnd < 0 ? "" : migration.slice(blockStart, blockEnd);
}

function proposalConstraint(column) {
  const guard = proposalConstraintGuard(column);
  const marker = "proposal_check_expression text := $proposal_check$";
  const expressionStart = guard.indexOf(marker);
  if (expressionStart < 0) return "";
  const start = expressionStart + marker.length;
  const end = guard.indexOf("$proposal_check$", start);
  return end < 0 ? "" : guard.slice(start, end);
}

function acceptsCatalogConstraint({ definition, expectedDefinition, validated }) {
  return validated === true && definition === expectedDefinition;
}

describe("Task 1 location identity migration", () => {
  it("adds generated UUID codes, backfills existing rows, and requires non-null values", () => {
    expect(migration).toMatch(/ALTER TABLE public\.locations[\s\S]*?ADD COLUMN IF NOT EXISTS location_code UUID DEFAULT uuid_generate_v4\(\)/i);
    expect(migration).toMatch(/UPDATE public\.locations\s+SET location_code\s*=\s*uuid_generate_v4\(\)\s+WHERE location_code IS NULL/i);
    const locationBackfill = migration.match(/UPDATE public\.locations\s+SET[\s\S]*?;/i)?.[0] ?? "";
    expect(locationBackfill).not.toMatch(/\b(?:location_id|name|address|latitude|longitude|is_active|retired_at)\s*=/i);
    expect(migration).toMatch(/ALTER TABLE public\.locations[\s\S]*?ALTER COLUMN location_code SET NOT NULL/i);
    expect(migration).toMatch(/pg_attribute/i);
    expect(migration).toMatch(/pg_attrdef/i);
    expect(migration).toMatch(/location_code[\s\S]*?uuid_generate_v4\(\)[\s\S]*?RAISE EXCEPTION/i);
  });

  it("creates and verifies a full unique index for every location code", () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS locations_location_code_uq\s+ON public\.locations\s*\(location_code\)/i);
    expect(migration).toMatch(/pg_index/i);
    expect(migration).toMatch(/indisunique/i);
    expect(migration).toMatch(/indpred IS NULL/i);
    expect(migration).toMatch(/indexprs IS NULL/i);
    expect(migration).toMatch(/indnatts\s*=\s*1/i);
    expect(migration).toMatch(/indnkeyatts\s*=\s*1/i);
    expect(migration).toMatch(/indkey\[0\][\s\S]*?attnum/i);
    expect(migration).toMatch(/locations_location_code_uq[\s\S]*?RAISE EXCEPTION/i);
  });

  it.each(PROPOSAL_COLUMNS)("stores %s as nullable JSONB with a strict database constraint", (column) => {
    const escapedColumn = quotedColumn(column);
    const expression = proposalConstraint(column);

    expect(migration).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${escapedColumn} JSONB`, "i"));
    expect(expression).not.toBe("");
    expect(expression).toContain(String.raw`BTRIM(${column}->>'address', E' \t\n\r\f' || chr(11))`);
    expect(expression).toMatch(new RegExp(`jsonb_typeof\\s*\\(\\s*${escapedColumn}\\s*\\)\\s*=\\s*'object'`, "i"));
    expect(expression).toMatch(new RegExp(`${escapedColumn}\\s*-\\s*ARRAY\\s*\\[\\s*'address'\\s*,\\s*'latitude'\\s*,\\s*'longitude'\\s*\\]::text\\[\\]\\s*=\\s*'\\{\\}'::jsonb`, "i"));
    expect(expression).toMatch(new RegExp(`NULLIF\\s*\\(\\s*BTRIM\\s*\\(\\s*${escapedColumn}\\s*->>\\s*'address'\\s*\\)\\s*,\\s*''\\s*\\)\\s+IS NOT NULL`, "i"));
    expect(expression).toMatch(new RegExp(`char_length\\s*\\(\\s*${escapedColumn}\\s*->>\\s*'address'\\s*\\)\\s*<=\\s*2000`, "i"));
    expect(expression).toMatch(new RegExp(`${escapedColumn}\\s*->>\\s*'latitude'[\\s\\S]*?-90[\\s\\S]*?90`, "i"));
    expect(expression).toMatch(new RegExp(`${escapedColumn}\\s*->>\\s*'longitude'[\\s\\S]*?-180[\\s\\S]*?180`, "i"));
    expect(expression).toMatch(new RegExp(`NOT \\(${escapedColumn}\\s*\\? 'latitude'\\)[\\s\\S]*?'null'[\\s\\S]*?NOT \\(${escapedColumn}\\s*\\? 'longitude'\\)[\\s\\S]*?'null'[\\s\\S]*?OR CASE[\\s\\S]*?'latitude'[\\s\\S]*?'number'[\\s\\S]*?'longitude'[\\s\\S]*?'number'`, "i"));
    expect(expression).toMatch(new RegExp(`${escapedColumn}[\\s\\S]*?'NaN'::numeric`, "i"));
    expect(migration).toMatch(new RegExp(`${quotedColumn(`chk_transportation_requests_${column}`)}[\\s\\S]*?RAISE EXCEPTION`, "i"));
  });

  it.each(PROPOSAL_COLUMNS)("rejects a same-named %s constraint weakened with OR TRUE", (column) => {
    const expression = proposalConstraint(column).trim();
    const guard = proposalConstraintGuard(column);
    const expectedDefinition = `CHECK (${expression})`;
    const weakenedDefinition = `CHECK ((${expression}) OR TRUE)`;

    // PostgreSQL deparses a scratch check built from the migration's expected expression;
    // accepting only that exact, validated catalog definition makes OR TRUE fail closed.
    expect(guard).toMatch(/CREATE TEMP TABLE[\s\S]*?ON COMMIT DROP/i);
    expect(guard).toMatch(/SELECT pg_get_constraintdef\(oid\)\s+INTO expected_constraint_definition[\s\S]*?conrelid = 'pg_temp\._expected_/i);
    expect(guard).toMatch(/constraint_definition\s+IS DISTINCT FROM\s+expected_constraint_definition/i);
    expect(guard).toMatch(/constraint_is_valid\s+IS DISTINCT FROM\s+TRUE/i);
    expect(guard).toMatch(/ALTER TABLE public\.transportation_requests ADD CONSTRAINT %I %s/i);
    expect(acceptsCatalogConstraint({ definition: expectedDefinition, expectedDefinition, validated: true })).toBe(true);
    expect(weakenedDefinition).toMatch(/\bOR\s+TRUE\b/i);
    expect(acceptsCatalogConstraint({ definition: weakenedDefinition, expectedDefinition, validated: true })).toBe(false);
  });

  it("fails closed on conflicting existing columns and does not change table or RLS scope", () => {
    expect(migration).toMatch(/information_schema\.columns/i);
    expect(migration).toMatch(/location_code_type IS DISTINCT FROM 'uuid'/i);
    expect(migration).toMatch(/location_code_default IS DISTINCT FROM 'uuid_generate_v4\(\)'/i);
    expect(migration).toMatch(/data_type\s*=\s*'jsonb'[\s\S]*?is_nullable\s*=\s*'YES'[\s\S]*?column_default IS NULL/i);
    expect(migration).toMatch(/valid_proposal_columns\s*<>\s*2/i);
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/i);
    expect(migration).toMatch(/indisunique[\s\S]*?indpred IS NULL/i);
    expect(migration).toMatch(/RAISE EXCEPTION/i);
    expect(migration).not.toMatch(/CREATE\s+TABLE/i);
    expect(migration).not.toMatch(/ENABLE ROW LEVEL SECURITY|CREATE POLICY|FORCE ROW LEVEL SECURITY/i);
  });
});
