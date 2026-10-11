export const CARGO_DEMO_NAMESPACE = "FLEETOPS_CARGO_DEMO_V1";

const id = number => "00000000-0000-4000-8000-" + String(number).padStart(12, "0");
const hash = number => number.toString(16).padStart(64, "0");
const demoTime = "2026-10-12T08:00:00.000Z";
const sampleLine = { line_id: "demo-oil-box", name: "Demo cooking oil", quantity_basis: "TRANSPORT_PACKAGE", expected_quantity: "10", unit: "box", reference_image_ref: null, handling: [] };

const sourceFor = serviceCode => {
  if (serviceCode === "RESTAURANT_SUPPLY_PICKUP") {
    return { kind: "REQUEST", system: "PMS", organization_id: "demo-restaurant-pms", external_request_id: "DEMO-REST-PICKUP" };
  }
  if (serviceCode === "RESTAURANT_FOOD_DELIVERY") {
    return { kind: "REQUEST", system: "POS", organization_id: "demo-restaurant-pos", external_request_id: "DEMO-REST-DELIVERY" };
  }
  return { kind: "SUPPLY", system: "SCM", organization_id: "demo-hotel-scm", external_request_id: "DEMO-HOTEL-SUPPLY" };
};

function createExecution({ base, serviceCode, pickupCount, pickupVersion = 2, pickupIssue = null, decisionAction = null, deliveryCount = null, deliveryIssue = null, secure = true }) {
  const source = sourceFor(serviceCode);
  const manifestRef = { kind: source.kind, id: id(base + 1), revision: 1, hash: hash(base + 2) };
  const manifest = {
    manifest_ref: manifestRef,
    source_ref: { system: source.system, organization_id: source.organization_id, external_request_id: source.external_request_id },
    service_code: serviceCode,
    lines: [{ ...sampleLine }],
  };
  const executionId = id(base + 3);
  const receipt = (stage, count, version, issueCode = null) => ({
    receipt_id: id(base + version + 10),
    execution_id: executionId,
    execution_version: version,
    manifest_hash: manifestRef.hash,
    payload: {
      submission_id: id(base + version + 20),
      manifest_ref: manifestRef,
      stage,
      observed_at: demoTime,
      lines: [{
        line_id: sampleLine.line_id,
        observed_quantity: String(count),
        condition: issueCode === "DAMAGE" ? "DAMAGED" : "INTACT",
        issue_code: issueCode,
        remarks: issueCode ? "Simulated demo discrepancy." : "",
        evidence_ids: [],
      }],
      receiver_confirmation_ref: null,
    },
  });
  const pickup = receipt("PICKUP", pickupCount, pickupVersion, pickupIssue);
  const decisionVersion = pickupVersion + 1;
  const decision = decisionAction ? {
    decision_id: id(base + 30 + decisionVersion),
    receipt_id: pickup.receipt_id,
    execution_version: decisionVersion,
    manifest_hash: manifestRef.hash,
    source_system: source.system,
    source_organization_id: source.organization_id,
    action: decisionAction,
    reason: "Simulated source decision: " + decisionAction + ".",
    simulated: true,
  } : null;
  const clearanceVersion = decision ? decisionVersion + 1 : pickupVersion + 1;
  const safetyReference = id(base + 40);
  const safetyProof = {
    kind: "POST_LOAD_SECUREMENT",
    receipt_id: pickup.receipt_id,
    manifest_hash: manifestRef.hash,
    approval_ref: "SIMULATED-FLEET-SAFETY",
    method: "simulated-fixture",
    reference: safetyReference,
    simulated: true,
  };
  const clearance = secure ? {
    clearance_id: id(base + 41),
    execution_id: executionId,
    receipt_id: pickup.receipt_id,
    decision_id: decision?.decision_id ?? null,
    manifest_hash: manifestRef.hash,
    version: clearanceVersion,
    safety_evidence_ref: safetyReference,
    safety_proof: safetyProof,
    simulated: true,
  } : null;
  let delivery = null;
  if (deliveryCount !== null) {
    delivery = receipt("DELIVERY", deliveryCount, clearanceVersion + 1, deliveryIssue);
    delivery.receiver_proof = {
      kind: "RECEIVER_CONFIRMATION",
      receipt_id: delivery.receipt_id,
      manifest_hash: manifestRef.hash,
      approval_ref: "SIMULATED-RECEIVING",
      method: "simulated-fixture",
      reference: id(base + 50),
      simulated: true,
    };
  }

  return { manifest, pickup, delivery, decision, clearance };
}

const cargoFixture = (idValue, serviceCode, execution, extra = {}) => ({
  id: idValue,
  namespace: CARGO_DEMO_NAMESPACE,
  simulated: true,
  load_type: "CARGO",
  service_code: serviceCode,
  source_label: sourceFor(serviceCode).organization_id,
  execution,
  ...extra,
});

export function buildCargoDemoFixtures() {
  const waitExecution = createExecution({
    base: 100,
    serviceCode: "HOTEL_SUPPLY_TRANSFER",
    pickupCount: 9,
    pickupIssue: "SHORTAGE",
    decisionAction: "WAIT",
    secure: false,
  });
  const recountExecution = createExecution({
    base: 100,
    serviceCode: "HOTEL_SUPPLY_TRANSFER",
    pickupCount: 10,
    pickupVersion: 4,
  });

  return [
    {
      id: "guest-transport",
      namespace: CARGO_DEMO_NAMESPACE,
      simulated: true,
      load_type: "PASSENGER",
      service_code: "GUEST_TRANSPORT",
      source_label: "Demo guest service",
      execution: null,
    },
    cargoFixture("clean-pickup", "RESTAURANT_SUPPLY_PICKUP", createExecution({
      base: 300,
      serviceCode: "RESTAURANT_SUPPLY_PICKUP",
      pickupCount: 10,
      deliveryCount: 10,
    })),
    cargoFixture("accepted-shortage", "RESTAURANT_FOOD_DELIVERY", createExecution({
      base: 400,
      serviceCode: "RESTAURANT_FOOD_DELIVERY",
      pickupCount: 9,
      pickupIssue: "SHORTAGE",
      decisionAction: "ACCEPT_OBSERVED",
      deliveryCount: 9,
    })),
    cargoFixture("wait-and-recount", "HOTEL_SUPPLY_TRANSFER", recountExecution, {
      timeline: [
        { event: "SOURCE_WAIT", execution: waitExecution },
        { event: "CLEAN_RECOUNT", execution: recountExecution },
      ],
    }),
    cargoFixture("rejected-shortage", "RESTAURANT_SUPPLY_PICKUP", createExecution({
      base: 500,
      serviceCode: "RESTAURANT_SUPPLY_PICKUP",
      pickupCount: 9,
      pickupIssue: "SHORTAGE",
      decisionAction: "REJECT_PICKUP",
      secure: false,
    })),
    cargoFixture("delivery-discrepancy", "HOTEL_SUPPLY_TRANSFER", createExecution({
      base: 600,
      serviceCode: "HOTEL_SUPPLY_TRANSFER",
      pickupCount: 9,
      pickupIssue: "SHORTAGE",
      decisionAction: "ACCEPT_OBSERVED",
      deliveryCount: 8,
      deliveryIssue: "SHORTAGE",
    })),
    cargoFixture("partner-timeout", "RESTAURANT_FOOD_DELIVERY", createExecution({
      base: 700,
      serviceCode: "RESTAURANT_FOOD_DELIVERY",
      pickupCount: 10,
      deliveryCount: 10,
    }), {
      feedback: { simulated: true, state: "FAILED", last_error_code: "GATEWAY_TIMEOUT" },
    }),
  ];
}
