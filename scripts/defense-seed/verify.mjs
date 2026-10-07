import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";
import { buildDefensePlan } from "./plan.mjs";
import { readLedger, checkSnapshots, checkExternalReferences } from "./ledger.mjs";
import { checkMediaRows } from "./media.mjs";

loadEnvLocal();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const plan = buildDefensePlan();
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await db.connect();
try {
  await client.query("BEGIN READ ONLY");
  const ledger = await readLedger(client);
  if (!ledger || ledger.state === "media_cleanup") throw new Error("Defense seed is absent or partially rolled back");
  const issues = [...await checkSnapshots(client, ledger, { ignoreRuntimeTimestamps: true }), ...await checkExternalReferences(client, ledger), ...await checkMediaRows(client, ledger.media)];
  const tripIds = ledger.ids.trips ?? [];
  const fuelIds = ledger.ids.fuelrecords ?? [];
  const maintIds = ledger.ids.vehiclemaintenance ?? [];
  const expenseIds = ledger.ids.expense_records ?? [];
  const { rows: tripRows } = await client.query(`
    SELECT to_char(start_time AT TIME ZONE 'Asia/Manila','YYYY-MM') AS month,
           trip_status,COUNT(*)::int AS count
      FROM trips WHERE trip_id=ANY($1::int[])
      GROUP BY 1,2 ORDER BY 1,2`, [tripIds]);
  const { rows: fuelRows } = await client.query(`
    SELECT to_char(fuel_date,'YYYY-MM') AS month,COUNT(*)::int AS count,
           SUM(liters)::numeric AS liters,SUM(amount)::numeric AS amount
      FROM fuelrecords WHERE fuel_record_id=ANY($1::int[])
      GROUP BY 1 ORDER BY 1`, [fuelIds]);
  const { rows: maintRows } = await client.query(`
    SELECT to_char(maintenance_date,'YYYY-MM') AS month,status,
           COUNT(*)::int AS count,SUM(cost)::numeric AS cost
      FROM vehiclemaintenance WHERE maintenance_id=ANY($1::int[])
      GROUP BY 1,2 ORDER BY 1,2`, [maintIds]);
  const { rows: expenseRows } = await client.query(`
    SELECT to_char(expense_date AT TIME ZONE 'Asia/Manila','YYYY-MM') AS month,status,
           COUNT(*)::int AS count,SUM(amount)::numeric AS amount
      FROM expense_records WHERE id=ANY($1::int[])
      GROUP BY 1,2 ORDER BY 1,2`, [expenseIds]);
  const completed = tripRows.filter((r) => r.trip_status === "Completed");
  const september = completed.find((r) => r.month === "2026-09")?.count ?? 0;
  const october = completed.find((r) => r.month === "2026-10")?.count ?? 0;
  if (september !== 21 || october !== 9) issues.push(`Completed trip distribution ${september}/${october}, expected 21/9`);
  const expectedFuelAmount = plan.fuelRecords.reduce((sum, f) => sum + f.liters * f.pricePerLiter, 0);
  const actualFuelAmount = fuelRows.reduce((sum, f) => sum + Number(f.amount), 0);
  if (actualFuelAmount !== expectedFuelAmount) issues.push(`Fuel total PHP ${actualFuelAmount}, expected ${expectedFuelAmount}`);
  const expectedMaint = plan.maintenance.reduce((sum, m) => sum + m.cost, 0);
  const actualMaint = maintRows.reduce((sum, m) => sum + Number(m.cost), 0);
  if (actualMaint !== expectedMaint) issues.push(`Maintenance total PHP ${actualMaint}, expected ${expectedMaint}`);
  const expectedExpense = plan.expenses.reduce((sum, e) => sum + e.amount, 0);
  const actualExpense = expenseRows.reduce((sum, e) => sum + Number(e.amount), 0);
  if (actualExpense !== expectedExpense) issues.push(`Expense total PHP ${actualExpense}, expected ${expectedExpense}`);
  console.log(JSON.stringify({ state: issues.length ? "failed" : "passed", planHash: ledger.planHash,
    trips: tripRows, fuel: fuelRows, maintenance: maintRows, expenses: expenseRows,
    expected: { completedSeptember: 21, completedOctober: 9, fuelAmount: expectedFuelAmount,
      maintenanceCost: expectedMaint, expenseAmount: expectedExpense }, issues }, null, 2));
  await client.query("ROLLBACK");
  if (issues.length) process.exitCode = 1;
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally { client.release(); await db.end(); }
