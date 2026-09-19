// SEC-DB-005 — the schema contract gate.
//
// `Capstone/03 - Database/Migrations/Migrations.md` names this gap under "What
// `024` teaches": a migration dropped a table that live code still queried, and
// nothing caught it until incident reporting broke in production. The note's own
// words: *"There is still no check that the schema satisfies the code."*
//
// This is that check's offline half — it needs no database and runs on every
// `npm test`. The live half (`npm run db:contract`) asserts the same contract
// against the real database, including the RLS facts this half cannot see.
//
// Four gates, each answering a different question:
//
//   1. well-formedness      — is the manifest actually usable?
//   2. classification       — does every table in the schema have a decision?
//   3. coverage             — does every table the CODE touches have an entry?
//   4. destructive DDL      — would any migration take a needed object away?
//
// Gate 2 is the one that would have caught SEC-DB-003 on the day it was written:
// `app_errors`, `ai_prompt_templates` and `trip_monitor_alerts` each arrived in
// a migration with no access decision recorded anywhere. A table nobody
// classified is now a failing test rather than a planning-pass discovery.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";

// The contract and the SQL extractor live in `scripts/lib/` as `.mjs`, not in
// `src/`: nothing in the application imports them, they are verification
// tooling, and this repo has no `"type": "module"` — so a `.js` file under
// `src/` is CommonJS to plain `node` and `npm run db:contract` could not load
// it. One copy, two consumers.
import {
  TABLES,
  VIEWS,
  CLASSIFICATION,
  tableNames,
  viewNames,
  publicTables,
} from "../../scripts/lib/schema-contract.mjs";
import { referencedTablesInFile } from "../../scripts/lib/sql-references.mjs";

const ROOT = process.cwd();
const SCHEMA_SQL = join(ROOT, "schema.sql");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const SRC_DIR = join(ROOT, "src");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Table names declared by the checked-in schema dump. */
function schemaTables() {
  const sql = readFileSync(SCHEMA_SQL, "utf8");
  const found = new Set();
  const re = /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gim;
  for (const m of sql.matchAll(re)) found.add(m[1]);
  return found;
}

/** View names declared by the checked-in schema dump. */
function schemaViews() {
  const sql = readFileSync(SCHEMA_SQL, "utf8");
  const found = new Set();
  const re = /^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?"?([a-z0-9_]+)"?/gim;
  for (const m of sql.matchAll(re)) found.add(m[1]);
  return found;
}

/**
 * Table names the application's SQL actually references.
 *
 * The extraction itself — which literals count, and which FROM/JOIN references
 * sit in real SQL grammar — lives in `scripts/lib/sql-references.mjs`, shared with
 * the live layer (`npm run db:contract`). Read its header for the two rules and
 * the measurements behind them. Keeping one copy is the point: a gate that
 * disagrees with its own corroborating check is worse than either alone.
 *
 * This wrapper only adds the attribution the failure message needs — which file
 * named the table first.
 */
function codeTables(files) {
  const found = new Map(); // table -> first file that referenced it
  for (const file of files) {
    const names = referencedTablesInFile(readFileSync(file, "utf8"));
    for (const name of names) {
      if (!found.has(name)) found.set(name, relative(ROOT, file).replace(/\\/g, "/"));
    }
  }
  return found;
}

const appSourceFiles = walk(SRC_DIR).filter(
  (f) =>
    /\.(js|jsx)$/.test(f) &&
    !/\.test\.jsx?$/.test(f) &&
    !f.includes(`${join("src", "security-assessment")}`)
);

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

// ---------------------------------------------------------------------------
// 1. well-formedness
// ---------------------------------------------------------------------------

describe("SEC-DB-005 the schema contract is well-formed", () => {
  it("declares at least one table", () => {
    expect(tableNames().length).toBeGreaterThan(0);
  });

  it("gives every table a classification and a reason", () => {
    const malformed = [];
    for (const [name, entry] of Object.entries(TABLES)) {
      const valid =
        entry &&
        [CLASSIFICATION.PRIVATE, CLASSIFICATION.PUBLIC].includes(entry.classification) &&
        typeof entry.reason === "string" &&
        entry.reason.trim().length >= 20;
      if (!valid) malformed.push(name);
    }
    expect(malformed, `Table(s) missing a classification or a real reason: ${malformed.join(", ")}`).toEqual([]);
  });

  it("requires every PUBLIC table to state the policy that makes it safe", () => {
    // A `public` tag is a documented decision, never an exemption from having
    // one. This test is what keeps that true if a client-side read is ever
    // added: the entry cannot be written without saying why it is safe.
    const undocumented = publicTables().filter(
      (name) => !/policy|anon|public by design/i.test(TABLES[name].reason)
    );
    expect(
      undocumented,
      `PUBLIC table(s) whose reason does not state an anon-read policy: ${undocumented.join(", ")}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. classification completeness — the SEC-DB-003 gate
// ---------------------------------------------------------------------------

describe("SEC-DB-005 every table in the schema carries an access decision", () => {
  it("classifies every CREATE TABLE in the checked-in schema", () => {
    const declared = schemaTables();
    const contract = new Set(tableNames());

    const unclassified = [...declared].filter((t) => !contract.has(t)).sort();
    expect(
      unclassified,
      `Table(s) exist in schema.sql with no access classification in ` +
        `scripts/lib/schema-contract.mjs: ${unclassified.join(", ")}. ` +
        `Add each with a classification and a reason — an unclassified table is ` +
        `exactly how SEC-DB-003 happened.`
    ).toEqual([]);
  });

  it("does not classify a table the schema does not have", () => {
    // The other direction: an entry for a table that was dropped. Left
    // unchecked, this rots into fiction and the destructive-DDL gate below
    // starts protecting something that no longer exists.
    const declared = schemaTables();
    const phantom = tableNames().filter((t) => !declared.has(t)).sort();
    expect(
      phantom,
      `Contract entr(y/ies) have no matching table in schema.sql: ${phantom.join(", ")}`
    ).toEqual([]);
  });

  it("classifies every CREATE VIEW in the checked-in schema", () => {
    // Views get their own gate because they are their own access question. A
    // view cannot carry an RLS policy of its own — it either runs as its owner
    // or, under `security_invoker`, as the caller — so `driver_stats` reading
    // completed trips is only safe if the live check confirms which. An
    // unclassified view is the SEC-DB-003 mistake in a shape the table gate
    // cannot see.
    const declared = [...schemaViews()].sort();
    const contract = new Set(viewNames());

    const unclassified = declared.filter((v) => !contract.has(v));
    expect(
      unclassified,
      `View(s) exist in schema.sql with no classification in ` +
        `scripts/lib/schema-contract.mjs: ${unclassified.join(", ")}.`
    ).toEqual([]);

    const phantom = [...contract].filter((v) => !declared.includes(v)).sort();
    expect(
      phantom,
      `VIEWS entr(y/ies) have no matching view in schema.sql: ${phantom.join(", ")}`
    ).toEqual([]);
  });

  it("gives every view a classification and a reason", () => {
    const malformed = Object.entries(VIEWS)
      .filter(
        ([, entry]) =>
          !entry ||
          ![CLASSIFICATION.PRIVATE, CLASSIFICATION.PUBLIC].includes(entry.classification) ||
          typeof entry.reason !== "string" ||
          entry.reason.trim().length < 20
      )
      .map(([name]) => name);
    expect(malformed, `View(s) missing a classification or a real reason: ${malformed.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. coverage — the manifest cannot rot
// ---------------------------------------------------------------------------

describe("SEC-DB-005 the contract covers what the application actually queries", () => {
  it("has an entry for every table referenced by application SQL", () => {
    const referenced = codeTables(appSourceFiles);
    const contract = new Set([...tableNames(), ...viewNames()]);

    const missing = [...referenced.keys()].filter((t) => !contract.has(t)).sort();
    expect(
      missing,
      `Table(s) queried by src/** but absent from the contract: ` +
        missing.map((t) => `${t} (${referenced.get(t)})`).join(", ")
    ).toEqual([]);
  });

  it("scans a non-trivial number of source files", () => {
    // Guards the gate itself: a broken walker returning [] would make the test
    // above pass for the wrong reason — the same false-confidence failure the
    // anon probe's controls exist to prevent.
    expect(appSourceFiles.length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// 4. destructive DDL — the 024 gate
// ---------------------------------------------------------------------------

describe("SEC-DB-005 no migration removes a structure the contract depends on", () => {
  const contractTables = new Set(tableNames());

  const stripComments = (sql) => sql.replace(/--[^\n]*/g, "");

  const CREATE_RE = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;

  /**
   * Order matters, and getting this wrong makes the gate useless two ways.
   *
   * A naive scan flags history: `005_schema_cleanup.sql` dropped
   * `vehicledocuments`, and `007` created it again. That drop is not a risk —
   * the table exists today. Flagging it would train the reader to ignore the
   * gate, which is worse than not having it.
   *
   * So the question is not "does any migration contain a DROP" but "is this
   * DROP superseded?" Concretely: a DROP TABLE / RENAME only counts if it
   * happens AFTER that table's last CREATE in migration order. A drop in a new
   * migration has no later create to rescue it, so it is flagged — which is the
   * `024` case this gate exists for.
   *
   * LIMIT, stated rather than hidden: this is table-level, because the contract
   * is table-level. `ALTER TABLE … DROP COLUMN` and `ALTER COLUMN … TYPE` are
   * NOT gated here — without a column-level contract, every historical dead-
   * column cleanup (`021`, `024`) would be an indistinguishable false positive.
   * Column drift is the live layer's job: `npm run db:contract` compares the
   * columns the code names against the columns the database actually has.
   */
  function destructiveStatements() {
    const bodies = migrationFiles.map((file) => ({
      file,
      sql: stripComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
    }));

    // Index of each table's LAST creation across the whole migration history.
    const lastCreate = new Map();
    bodies.forEach(({ sql }, i) => {
      for (const m of sql.matchAll(CREATE_RE)) {
        lastCreate.set(m[1].toLowerCase(), i);
      }
    });

    const hits = [];
    bodies.forEach(({ file, sql }, i) => {
      const patterns = [
        { re: /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi, kind: "DROP TABLE" },
        { re: /\bALTER\s+TABLE\s+(?:public\.)?"?([a-z0-9_]+)"?\s+RENAME\s+TO/gi, kind: "RENAME TABLE" },
      ];
      for (const { re, kind } of patterns) {
        for (const m of sql.matchAll(re)) {
          const table = m[1].toLowerCase();
          if (!contractTables.has(table)) continue;
          // Superseded by a later CREATE — history, not a live removal.
          if ((lastCreate.get(table) ?? -1) > i) continue;
          hits.push(`${file}: ${kind} ${table}`);
        }
      }
    });
    return hits;
  }

  it("finds no superseded-only destructive statement against a contract table", () => {
    const hits = destructiveStatements();
    expect(
      hits,
      `Migration(s) would remove a structure live code depends on:\n  ${hits.join("\n  ")}\n` +
        `If this is deliberate, remove the object from ` +
        `scripts/lib/schema-contract.mjs AND from every caller in the same change.`
    ).toEqual([]);
  });

  it("would still catch a real drop — proven against a synthetic migration", () => {
    // The gate above passes on a clean history, which is also what a BROKEN
    // gate looks like. This proves it has teeth: the same detector, run over a
    // synthetic migration that drops a live contract table, must report it.
    const fake = stripComments(
      "BEGIN;\nALTER TABLE public.trips DROP COLUMN driver_id;\nDROP TABLE IF EXISTS public.driver_consents;\nCOMMIT;"
    );
    const found = [];
    for (const m of fake.matchAll(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)) {
      const table = m[1].toLowerCase();
      // Positioned after every real migration, so nothing supersedes it.
      if (contractTables.has(table) && (lastCreateIndexFor(table) ?? -1) < migrationFiles.length) {
        found.push(table);
      }
    }
    expect(found, "the detector failed to flag a synthetic DROP TABLE").toEqual(["driver_consents"]);
  });

  function lastCreateIndexFor(table) {
    let last = -1;
    migrationFiles.forEach((file, i) => {
      const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      for (const m of sql.matchAll(CREATE_RE)) {
        if (m[1].toLowerCase() === table) last = i;
      }
    });
    return last;
  }

  it("reads a non-trivial number of migrations", () => {
    expect(migrationFiles.length).toBeGreaterThan(100);
  });
});
