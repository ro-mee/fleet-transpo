// Find the database objects a piece of source text names in its SQL.
//
// Shared by the two halves of the schema contract, because they must agree:
// `src/security-assessment/schema-contract.security.test.js` (offline, every
// `npm test`) and `scripts/verify-db-contract.mjs` (live, `npm run db:contract`).
// Two copies of this logic would drift, and a gate that disagrees with its own
// corroborating check is worse than either alone.
//
// This is a lexical scan, not a parser, and it has to survive two opposite
// failure modes: prose read as SQL (false alarms, which train people to ignore
// the gate) and SQL missed entirely (silent rot — the `024` failure, where a
// migration dropped a table that live code still queried and nothing caught it
// until incident reporting broke in production). Two rules do that work.
//
// **1. Extraction runs on SQL literals only** — template and quoted strings
// carrying a statement keyword. An earlier draft claimed "prose lives in
// comments and JSX, not in those", and that claim is false: the LLM system
// prompt in `src/lib/dispatch/copilot-prompt.js` is a quoted string containing
// the English words "select", "update" and "from both". Tightening the literal
// predicate to exclude it was measured and REJECTED — it also excludes
// `` `SELECT * FROM integration_log` ``, a real table reference, so it trades a
// false alarm for a false negative and weakens the gate. The predicate therefore
// stays deliberately loose, and precision is bought at the reference level.
//
// **2. A reference must sit in SQL grammar.** In a real statement the table name
// is followed by a clause keyword, a terminator, a comma, a closing paren, or an
// optional alias and then one of those — never by more English. That is what
// separates `FROM both pairs and exclusions` (rejected) from
// `SELECT * FROM integration_log` (accepted, ends the literal) and
// `FROM vehicles v\n LEFT JOIN …` (accepted, alias then clause). Measured
// against the loose rule over `src/**`: identical results except the one prose
// match, so the precision is free.
//
// LIMIT, stated rather than hidden: a SQL *fragment* with no statement keyword
// (a bare `` `FROM trips t WHERE …` `` appended to a buffer) is not scanned.
// That is a deliberate trade for precision, and it is why the live layer also
// compares code-named objects against the real database rather than relying on
// this alone.

// Tokens that follow FROM/JOIN/UPDATE in real SQL but are not tables — CTE
// names, set-returning functions, catalog relations. Anything not listed here
// and not in the contract FAILS, so a new table is a conscious addition.
export const NOT_A_TABLE = new Set([
  "select", "where", "set", "values", "lateral", "only", "dual", "unnest",
  "generate_series", "jsonb_array_elements", "jsonb_each", "json_array_elements",
  "information_schema", "pg_catalog", "pg_class", "pg_constraint", "pg_indexes",
  "pg_attribute", "pg_namespace", "pg_proc", "pg_type", "pg_tables",
  "jsonb_to_recordset", "json_to_recordset", "regexp_split_to_table",
  "current_date", "current_timestamp", "now", "distinct", "all",
]);

const SQL_CLAUSE_TAIL = String.raw`(?:\s+AS)?(?:\s+"?[a-z_][a-z0-9_]*"?)?\s*(?=[,;)]|$|\b(?:WHERE|JOIN|ON|USING|GROUP|ORDER|LIMIT|OFFSET|HAVING|UNION|RETURNING|SET|VALUES|LEFT|RIGHT|INNER|FULL|CROSS|OUTER|NATURAL|AS)\b|\()`;

export const REFERENCE_RE = new RegExp(
  // `FOR UPDATE OF x` and `TRIM(BOTH FROM x)` put these words in SQL grammar
  // positions that are not table positions.
  String.raw`(?<!\bFOR\s)(?<!\bBOTH\s)(?<!\bLEADING\s)(?<!\bTRAILING\s)` +
    String.raw`\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?([a-z_][a-z0-9_]*)"?` +
    SQL_CLAUSE_TAIL,
  "gi"
);

/** Does this string literal carry a SQL statement keyword? */
export const looksLikeSql = (s) =>
  /\bSELECT\b/i.test(s) ||
  /\bINSERT\s+INTO\b/i.test(s) ||
  /\bDELETE\s+FROM\b/i.test(s) ||
  (/\bUPDATE\b/i.test(s) && /\bSET\b/i.test(s));

/** Template literals, then single/double-quoted strings. */
export function stringLiterals(text) {
  const out = [];
  for (const m of text.matchAll(/`(?:[^`\\]|\\.)*`/gs)) out.push(m[0]);
  for (const m of text.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g)) out.push(m[0]);
  return out;
}

/**
 * Drop `--` line comments, which are SQL, not prose.
 *
 * A query literal may carry its own commentary — `transport-requests/[id]/route.js`
 * explains "Every dispatch raised from this request, newest first" inside the
 * SQL — and without this the scan reads that English as a table named `this`.
 * The cost of stripping is a missed reference when a `--` sits inside a SQL
 * string literal; that is a false negative, not a false alarm, and the live
 * layer is what covers it.
 */
export const stripSqlComments = (literal) => literal.replace(/--[^\n]*/g, "");

/**
 * DB objects named by the SQL in one source file's text.
 *
 * SCOPE, stated rather than hidden: CTE names are collected per FILE, not per
 * statement. They have to be, because shared fragments are interpolated —
 * `src/app/api/fuel/allocations/route.js` defines `consumed` and `committed` in
 * a module-level `USAGE_CTES` constant and joins them from a *different*
 * template literal, so a per-statement scope sees the JOIN and not the
 * definition. The cost is that a real table sharing a name with a CTE defined
 * elsewhere in the same file would be skipped; the live layer compares named
 * objects against the actual database and is what closes that.
 *
 * @param {string} text Source file contents.
 * @returns {Set<string>} Lower-cased object names, in first-seen order.
 */
export function referencedTablesInFile(text) {
  // Gate on the raw literal — a comment-only string is not SQL — then strip.
  const sqlLiterals = stringLiterals(text).filter(looksLikeSql).map(stripSqlComments);

  const ctes = new Set();
  for (const literal of sqlLiterals) {
    for (const m of literal.matchAll(/\b([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)) {
      ctes.add(m[1].toLowerCase());
    }
  }

  const found = new Set();
  for (const literal of sqlLiterals) {
    for (const m of literal.matchAll(REFERENCE_RE)) {
      const name = m[1].toLowerCase();
      if (NOT_A_TABLE.has(name) || ctes.has(name)) continue;
      found.add(name);
    }
  }
  return found;
}
