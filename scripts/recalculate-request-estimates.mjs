import { loadEnvLocal } from "./load-env.mjs";
loadEnvLocal();

import { query } from "../src/lib/db.js";
import { estimateTrip } from "../src/lib/geo/distance.js";

async function main() {
  console.log("🚀 Recalculating route estimates for all transportation requests...");

  const { rows } = await query(`
    SELECT request_id, pickup_location, dropoff_location, estimated_distance, estimated_duration
      FROM transportation_requests
     WHERE deleted_at IS NULL
  `);

  console.log(`Found ${rows.length} existing transportation requests.`);

  let updatedCount = 0;
  for (const r of rows) {
    const est = estimateTrip(r.pickup_location, r.dropoff_location);
    await query(
      `UPDATE transportation_requests
          SET estimated_distance = $1, estimated_duration = $2, updated_at = NOW()
        WHERE request_id = $3`,
      [est.distanceKm, est.durationMin, r.request_id]
    );
    console.log(
      `Updated Request #${r.request_id} (${r.pickup_location || "—"} ➔ ${r.dropoff_location || "—"}): ${est.distanceKm} km, ${est.durationMin} mins (${est.basis})`
    );
    updatedCount++;
  }

  console.log(`🎉 Recalculated estimates for ${updatedCount} requests!`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error recalculating estimates:", err);
  process.exit(1);
});
