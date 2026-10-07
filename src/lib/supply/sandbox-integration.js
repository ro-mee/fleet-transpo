import { createHash } from "node:crypto";
import { query, withTransaction } from "@/lib/db";

export class SupplyIntegrationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "SupplyIntegrationError";
    this.status = status;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const hash = (value) => createHash("sha256").update(stableStringify(value)).digest("hex");

function responseFor(shipment, replayed = false) {
  return {
    accepted: true,
    sandbox: true,
    replayed,
    shipment_id: shipment.supply_shipment_id,
    external_request_id: shipment.external_request_id,
    manifest_revision: Number(shipment.current_manifest_revision),
    status: shipment.status,
  };
}

/** Persist one already-validated SCM sandbox event without mutating prior revisions. */
export async function ingestSandboxTransportEvent(event, actorEmployeeId) {
  const eventHash = hash(event);
  const manifestHash = hash(event.request);

  try {
    return await withTransaction(async (tx) => {
    const { rows: insertedInbox } = await tx.query(
      `INSERT INTO supply_integration_inbox
         (source_organization_id, external_request_id, source_event_id, event_type,
          source_sequence, correlation_id, schema_version, event_hash,
          processing_status, response_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACCEPTED', '{}'::jsonb)
       ON CONFLICT (source_organization_id, source_event_id) DO NOTHING
       RETURNING supply_inbox_id`,
      [
        event.source.organization_id,
        event.request.external_request_id,
        event.event_id,
        event.event_type,
        event.sequence,
        event.correlation_id,
        event.schema_version,
        eventHash,
      ]
    );

    if (!insertedInbox[0]) {
      const { rows } = await tx.query(
        `SELECT event_hash, processing_status, response_snapshot
           FROM supply_integration_inbox
          WHERE source_organization_id = $1 AND source_event_id = $2
          FOR UPDATE`,
        [event.source.organization_id, event.event_id]
      );
      if (rows[0]?.event_hash !== eventHash) {
        throw new SupplyIntegrationError("This source event ID was already used with a different payload.", 409);
      }
      if (rows[0]?.processing_status === "REJECTED") {
        const rejection = rows[0].response_snapshot ?? {};
        throw new SupplyIntegrationError(
          rejection.error || "This source event was previously rejected.",
          Number(rejection.status) || 409
        );
      }
      return { ...rows[0].response_snapshot, replayed: true };
    }

    const { rows: shipments } = await tx.query(
      `SELECT supply_shipment_id, external_request_id, current_manifest_revision,
              source_sequence, status
         FROM supply_shipments
        WHERE source_organization_id = $1 AND external_request_id = $2
        FOR UPDATE`,
      [event.source.organization_id, event.request.external_request_id]
    );
    let shipment = shipments[0];
    let replayed = false;

    if (!shipment) {
      if (event.event_type !== "TransportRequestApproved" || event.request.manifest_revision !== 1) {
        throw new SupplyIntegrationError("A shipment must begin with an approved revision 1 event.", 409);
      }
      const status = event.request.pickup.ready ? "READY_FOR_PLANNING" : "WAITING_FOR_PICKUP";
      const { rows } = await tx.query(
        `INSERT INTO supply_shipments
           (source_organization_id, external_request_id, external_approver_ref,
            current_manifest_revision, status, pickup_snapshot, delivery_snapshot,
            requested_timezone, delivery_window_start, delivery_window_end,
            source_sequence, source_correlation_id, source_occurred_at)
         VALUES ($1, $2, $3, 1, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12)
         RETURNING supply_shipment_id, external_request_id, current_manifest_revision, status`,
        [
          event.source.organization_id,
          event.request.external_request_id,
          event.request.approver_ref,
          status,
          JSON.stringify(event.request.pickup),
          JSON.stringify(event.request.delivery),
          event.request.timezone,
          event.request.delivery.window_start,
          event.request.delivery.window_end,
          event.sequence,
          event.correlation_id,
          event.occurred_at,
        ]
      );
      shipment = rows[0];
    } else {
      const { rows: revisions } = await tx.query(
        `SELECT manifest_hash
           FROM supply_manifest_revisions
          WHERE supply_shipment_id = $1 AND manifest_revision = $2`,
        [shipment.supply_shipment_id, event.request.manifest_revision]
      );

      if (event.request.manifest_revision === Number(shipment.current_manifest_revision)) {
        if (revisions[0]?.manifest_hash !== manifestHash) {
          throw new SupplyIntegrationError("A manifest revision is immutable; send a higher revision to change it.", 409);
        }
        if (event.sequence <= Number(shipment.source_sequence)) {
          throw new SupplyIntegrationError("Event sequence must advance for this request.", 409);
        }
        await tx.query(
          `UPDATE supply_shipments
              SET source_sequence = $2,
                  source_correlation_id = $3,
                  source_occurred_at = $4,
                  updated_at = now()
            WHERE supply_shipment_id = $1`,
          [shipment.supply_shipment_id, event.sequence, event.correlation_id, event.occurred_at]
        );
        replayed = true;
      } else {
        if (event.event_type !== "ManifestUpdated") {
          throw new SupplyIntegrationError("An existing shipment can only change through ManifestUpdated.", 409);
        }
        if (event.request.manifest_revision !== Number(shipment.current_manifest_revision) + 1) {
          throw new SupplyIntegrationError("Manifest revision must advance by exactly one.", 409);
        }
        if (event.sequence <= Number(shipment.source_sequence)) {
          throw new SupplyIntegrationError("Event sequence must advance for this request.", 409);
        }
        if (!["READY_FOR_PLANNING", "WAITING_FOR_PICKUP", "BLOCKED"].includes(shipment.status)) {
          throw new SupplyIntegrationError("The manifest cannot change after allocation or loading has started.", 409);
        }
        const nextStatus = event.request.pickup.ready ? "READY_FOR_PLANNING" : "WAITING_FOR_PICKUP";
        const { rows } = await tx.query(
          `UPDATE supply_shipments
              SET external_approver_ref = $2,
                  current_manifest_revision = $3,
                  status = $4,
                  pickup_snapshot = $5::jsonb,
                  delivery_snapshot = $6::jsonb,
                  requested_timezone = $7,
                  delivery_window_start = $8,
                  delivery_window_end = $9,
                  source_sequence = $10,
                  source_correlation_id = $11,
                  source_occurred_at = $12,
                  updated_at = now()
            WHERE supply_shipment_id = $1
            RETURNING supply_shipment_id, external_request_id, current_manifest_revision, status`,
          [
            shipment.supply_shipment_id,
            event.request.approver_ref,
            event.request.manifest_revision,
            nextStatus,
            JSON.stringify(event.request.pickup),
            JSON.stringify(event.request.delivery),
            event.request.timezone,
            event.request.delivery.window_start,
            event.request.delivery.window_end,
            event.sequence,
            event.correlation_id,
            event.occurred_at,
          ]
        );
        shipment = rows[0];
      }
    }

    if (!replayed) {
      await tx.query(
        `INSERT INTO supply_manifest_revisions
           (supply_shipment_id, manifest_revision, schema_version, manifest_hash,
            manifest_snapshot, source_event_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          shipment.supply_shipment_id,
          event.request.manifest_revision,
          event.schema_version,
          manifestHash,
          JSON.stringify(event.request),
          event.event_id,
        ]
      );
      await tx.query(
        `INSERT INTO supply_shipment_events
           (supply_shipment_id, event_type, manifest_revision, source_event_id,
            correlation_id, actor_type, actor_ref, event_data, occurred_at)
         VALUES ($1, $2, $3, $4, $5, 'FLEET_EMPLOYEE', $6, $7::jsonb, $8)`,
        [
          shipment.supply_shipment_id,
          event.event_type === "TransportRequestApproved" ? "SANDBOX_REQUEST_IMPORTED" : "SANDBOX_MANIFEST_UPDATED",
          event.request.manifest_revision,
          event.event_id,
          event.correlation_id,
          String(actorEmployeeId),
          JSON.stringify({ source_organization_id: event.source.organization_id, event_hash: eventHash }),
          event.occurred_at,
        ]
      );
    }

    const response = responseFor(shipment, replayed);
    await tx.query(
      `UPDATE supply_integration_inbox
          SET response_snapshot = $2::jsonb
        WHERE source_organization_id = $1 AND source_event_id = $3`,
      [event.source.organization_id, JSON.stringify(response), event.event_id]
    );
    return response;
    });
  } catch (error) {
    if (!(error instanceof SupplyIntegrationError)) throw error;

    // Keep a safe rejection receipt after the business transaction rolls back.
    // Only identifiers, the payload hash and a bounded error snapshot are kept;
    // the untrusted event body is not copied into the rejection record.
    const rejection = {
      accepted: false,
      rejected: true,
      error: error.message,
      status: error.status,
    };
    await query(
      `INSERT INTO supply_integration_inbox
         (source_organization_id, external_request_id, source_event_id, event_type,
          source_sequence, correlation_id, schema_version, event_hash,
          processing_status, response_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'REJECTED', $9::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        event.source.organization_id,
        event.request.external_request_id,
        event.event_id,
        event.event_type,
        event.sequence,
        event.correlation_id,
        event.schema_version,
        eventHash,
        JSON.stringify(rejection),
      ]
    );
    throw error;
  }
}

export async function listSupplyShipments() {
  const { rows } = await query(
    `SELECT s.supply_shipment_id, s.source_organization_id, s.external_request_id,
            s.current_manifest_revision, s.status, s.requested_timezone,
            s.delivery_window_start, s.delivery_window_end,
            s.pickup_snapshot->>'site_id' AS pickup_site_id,
            s.delivery_snapshot->>'site_id' AS delivery_site_id,
            r.manifest_snapshot->'lines' AS lines
       FROM supply_shipments s
       JOIN supply_manifest_revisions r
         ON r.supply_shipment_id = s.supply_shipment_id
        AND r.manifest_revision = s.current_manifest_revision
      ORDER BY s.delivery_window_start, s.supply_shipment_id`
  );
  return rows.map((row) => {
    const lines = Array.isArray(row.lines) ? row.lines : [];
    let grossWeightKg = 0;
    let nominalVolumeM3 = 0;
    let packageCount = 0;
    for (const line of lines) {
      const count = Number(line.transport_package_count) || 0;
      packageCount += count;
      grossWeightKg += count * (Number(line.gross_weight_kg_per_package) || 0);
      nominalVolumeM3 += count * (Number(line.dimensions_m?.length) || 0) * (Number(line.dimensions_m?.width) || 0) * (Number(line.dimensions_m?.height) || 0);
    }
    return {
      ...row,
      lines: undefined,
      package_count: packageCount,
      gross_weight_kg: grossWeightKg,
      nominal_volume_m3: nominalVolumeM3,
    };
  });
}

export async function getSupplyShipmentForEvaluation(shipmentId, vehicleId) {
  const { rows } = await query(
    `SELECT r.manifest_snapshot, p.*, v.vehicle_status
       FROM supply_shipments s
       JOIN supply_manifest_revisions r
         ON r.supply_shipment_id = s.supply_shipment_id
        AND r.manifest_revision = s.current_manifest_revision
       JOIN vehicles v ON v.vehicle_id = $2 AND v.deleted_at IS NULL
       LEFT JOIN vehicle_cargo_profiles p ON p.vehicle_id = v.vehicle_id
      WHERE s.supply_shipment_id = $1
      LIMIT 1`,
    [shipmentId, vehicleId]
  );
  if (!rows[0]) return null;
  const { manifest_snapshot: manifest, vehicle_status: vehicleStatus, ...profile } = rows[0];
  return { manifest, profile: { ...profile, vehicle_status: vehicleStatus } };
}
