<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Supabase migrations — apply via direct DB connection

The `supabase` CLI is NOT usable in this repo: `.env` line 8 is an orphaned token (a bare host string with no `=`) that breaks `supabase` CLI parsing, and `psql`/`docker` are unavailable. Pasting migration SQL into the Supabase SQL editor was found UNRELIABLE — applies there were silently not landing on the project the app actually uses (`dnxuphhxlzidvwtdqqkq`, db `postgres`, schema `public`) because the browser editor can target a different project/DB.

The reliable path is a direct connection using `pg` + the real `DATABASE_URL` from `.env`. Write a small Node script in the repo dir (so it resolves `pg` from `node_modules`), wrap the migration in `BEGIN; ... COMMIT;`, run it, then confirm via `information_schema`. See prior examples applied this way: `017_driver_consents.sql`, `018_cleanup_dead_columns.sql`. Verify table/column presence after applying, and re-run the app's runtime queries against the live DB to confirm nothing is broken.
