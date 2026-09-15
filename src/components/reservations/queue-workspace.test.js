import { describe, it, expect, beforeEach } from "vitest";
import { bucketProposal, DECISION_LABELS } from "@/lib/dispatch/decision";

describe("bucketProposal decision truthfulness", () => {
  const safePair = {
    checks: [{ id: "capacity", status: "verified" }],
    readiness: "VERIFIED",
    evaluated: true,
    feasibility: { verdict: "SAFE" },
    reviewable: true,
  };

  it("classifies verified safe pairs as Ready for confirmation", () => {
    const proposal = { pair: safePair, outcome: "VERIFIED" };
    expect(bucketProposal(proposal, Date.now())).toBe("Ready for confirmation");
  });

  it("classifies dependent proposals as Waiting for preceding request", () => {
    const proposal = {
      pair: safePair,
      outcome: "VERIFIED",
      dependsOnRequestIds: [42],
    };
    expect(bucketProposal(proposal, Date.now())).toBe("Waiting for preceding request");
  });

  it("classifies tight feasibility as Review required", () => {
    const tightProposal = {
      pair: { ...safePair, feasibility: { verdict: "TIGHT" } },
      outcome: "VERIFIED",
    };
    expect(bucketProposal(tightProposal, Date.now())).toBe("Review required");
  });

  it("no longer holds ready pairs for advisories, but keeps maintenance alerts in review", () => {
    const advisoryProposal = {
      pair: {
        ...safePair,
        advisories: [{ message: "Heavy traffic near airport" }],
      },
      outcome: "VERIFIED",
    };
    expect(bucketProposal(advisoryProposal, Date.now())).toBe("Ready for confirmation");

    const maintenanceProposal = {
      pair: {
        ...safePair,
        vehicle: { maintenance: { risk: "high", basis: "date" } },
      },
      outcome: "VERIFIED",
    };
    expect(bucketProposal(maintenanceProposal, Date.now())).toBe("Review required");
  });

  it("classifies hard conflicts or infeasible routes as Blocked", () => {
    const blockedProposal = {
      pair: {
        ...safePair,
        hardConflicts: [{ severity: "blocking", message: "Vehicle overlap" }],
      },
      outcome: "VERIFIED",
    };
    expect(bucketProposal(blockedProposal, Date.now())).toBe("Blocked");

    const infeasibleProposal = {
      pair: {
        ...safePair,
        feasibility: { verdict: "INFEASIBLE" },
      },
      outcome: "VERIFIED",
    };
    expect(bucketProposal(infeasibleProposal, Date.now())).toBe("Blocked");
  });

  it("classifies missing check evidence as Needs verification", () => {
    const missingProposal = {
      pair: { ...safePair, checks: [{ id: "capacity", status: "missing" }] },
      outcome: "VERIFIED",
    };
    expect(bucketProposal(missingProposal, Date.now())).toBe("Needs verification");
  });

  it("truthfully handles unplaced and unevaluated proposals", () => {
    const unplaced = {
      pair: null,
      candidateEvaluationComplete: true,
    };
    expect(bucketProposal(unplaced, Date.now())).toBe("Needs verification");

    const unevaluated = {
      pair: null,
      candidateEvaluationComplete: false,
    };
    expect(bucketProposal(unevaluated, Date.now())).toBe("Not evaluated");

    const explicitNotEvaluated = {
      outcome: "NOT_EVALUATED",
    };
    expect(bucketProposal(explicitNotEvaluated, Date.now())).toBe("Not evaluated");
  });

  it("handles null or undefined safely", () => {
    expect(bucketProposal(null)).toBe("Not evaluated");
    expect(bucketProposal(undefined)).toBe("Not evaluated");
  });

  it("maps accurately to DECISION_LABELS", () => {
    expect(DECISION_LABELS.ALL_CLEAR).toBe("Ready for confirmation");
    expect(DECISION_LABELS.REVIEW_REQUIRED).toBe("Review required");
    expect(DECISION_LABELS.BLOCKED).toBe("Blocked");
    expect(DECISION_LABELS.INSUFFICIENT_DATA).toBe("Needs verification");
  });
});

import { getCategoryInfo, getDerivedTags } from "@/components/reservations/reservation-queue-table";

describe("getCategoryInfo and getDerivedTags category badges", () => {
  it("extracts category from vehiclecategories join", () => {
    const req = { vehiclecategories: { category_name: "Guest Transportation" } };
    expect(getCategoryInfo(req)).toBe("Guest Transportation");
  });

  it("extracts category from requested_vehicle_type fallback", () => {
    const req = { requested_vehicle_type: "Hotel Operations" };
    expect(getCategoryInfo(req)).toBe("Hotel Operations");
  });

  it("creates trip attribute tags for Airport and Group requests without duplicate category pills", () => {
    const req = {
      pickup_location: "NAIA Terminal 2",
      dropoff_location: "CoCo Star Hotel",
      passenger_count: 4,
      vehiclecategories: { category_name: "Guest Transportation" },
    };
    const tags = getDerivedTags(req);
    expect(tags.some((t) => t.type === "airport" && t.label === "Airport")).toBe(true);
    expect(tags.some((t) => t.type === "group" && t.label === "Group")).toBe(true);
    // Category is rendered inline beside the reservation number, not as a pill tag
    expect(tags.some((t) => t.type === "category")).toBe(false);
  });

  it("handles VIP guest categories with VIP tag", () => {
    const vipReq = {
      is_vip: true,
      vehiclecategories: { category_name: "VIP Guest" },
    };
    const tags = getDerivedTags(vipReq);
    expect(tags.filter((t) => t.type === "vip")).toHaveLength(1);
    expect(tags.some((t) => t.type === "category")).toBe(false);
  });
});

import {
  getReservationMessages,
  setReservationMessages,
  clearReservationMessages,
  clearAllReservationMessages,
  getSharedMessages,
  setSharedMessages,
  clearSharedMessages,
} from "@/components/reservations/copilot-conversation";

describe("CopilotConversation per-reservation isolated session memory", () => {
  beforeEach(() => {
    clearAllReservationMessages();
  });

  it("isolates conversation memory per reservation so reservations do not see other conversations", () => {
    expect(getReservationMessages(502)).toEqual([]);
    expect(getReservationMessages(500)).toEqual([]);

    // Convo with RS-KXIH (request 502)
    setReservationMessages(502, [
      {
        role: "user",
        content: "Why no match?",
        at: Date.now(),
        requestId: 502,
        reservationNumber: "RS-KXIH",
        guestName: "Okada Patron",
      },
      {
        role: "assistant",
        content: "Only one vehicle was checked for this request, and it's blocked...",
        at: Date.now(),
        requestId: 502,
        reservationNumber: "RS-KXIH",
        guestName: "Okada Patron",
      },
    ]);

    // Convo with RS-ZK1U (request 500)
    setReservationMessages(500, [
      {
        role: "user",
        content: "Anong driver ang recommended dito?",
        at: Date.now(),
        requestId: 500,
        reservationNumber: "RS-ZK1U",
        guestName: "Maria Clara",
      },
    ]);

    // RS-KXIH only contains its own 2 messages
    const kxihMsgs = getReservationMessages(502);
    expect(kxihMsgs).toHaveLength(2);
    expect(kxihMsgs[0].content).toBe("Why no match?");
    expect(kxihMsgs[0].reservationNumber).toBe("RS-KXIH");
    expect(kxihMsgs[1].content).toContain("Only one vehicle was checked");

    // RS-ZK1U only contains its own 1 message
    const zk1uMsgs = getReservationMessages(500);
    expect(zk1uMsgs).toHaveLength(1);
    expect(zk1uMsgs[0].content).toBe("Anong driver ang recommended dito?");
    expect(zk1uMsgs[0].reservationNumber).toBe("RS-ZK1U");

    // Fresh reservation has empty convo
    expect(getReservationMessages(999)).toEqual([]);
  });

  it("retains each reservation's conversation independently when navigating back and forth", () => {
    // 1. Dispatcher asks question on RS-KXIH
    setReservationMessages(502, (prev) => [
      ...prev,
      { role: "user", content: "Check status for RS-KXIH", at: Date.now() },
    ]);

    // 2. Dispatcher navigates to RS-G07O and chats
    setReservationMessages(501, (prev) => [
      ...prev,
      { role: "user", content: "May van ba para kay Alexander?", at: Date.now() },
    ]);

    // 3. Dispatcher returns to RS-KXIH: conversation is intact and untouched by RS-G07O
    const kxihAfter = getReservationMessages(502);
    expect(kxihAfter).toHaveLength(1);
    expect(kxihAfter[0].content).toBe("Check status for RS-KXIH");

    // 4. Dispatcher returns to RS-G07O: conversation is intact
    const g07oAfter = getReservationMessages(501);
    expect(g07oAfter).toHaveLength(1);
    expect(g07oAfter[0].content).toBe("May van ba para kay Alexander?");
  });

  it("clears conversation memory selectively only for the active reservation", () => {
    setReservationMessages(502, [{ role: "user", content: "KXIH convo" }]);
    setReservationMessages(500, [{ role: "user", content: "ZK1U convo" }]);

    expect(getReservationMessages(502)).toHaveLength(1);
    expect(getReservationMessages(500)).toHaveLength(1);

    // Clear only 502
    clearReservationMessages(502);

    // 502 is cleared, 500 remains intact
    expect(getReservationMessages(502)).toHaveLength(0);
    expect(getReservationMessages(500)).toHaveLength(1);
    expect(getReservationMessages(500)[0].content).toBe("ZK1U convo");
  });

  it("clears all reservation conversations when clearAllReservationMessages is called", () => {
    setReservationMessages(502, [{ role: "user", content: "KXIH convo" }]);
    setReservationMessages(500, [{ role: "user", content: "ZK1U convo" }]);

    clearAllReservationMessages();

    expect(getReservationMessages(502)).toHaveLength(0);
    expect(getReservationMessages(500)).toHaveLength(0);
  });
});
