import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { bucketProposal, DECISION_LABELS } from "@/lib/dispatch/decision";

const panelHookState = vi.hoisted(() => ({ slots: [], cursor: 0 }));
const panelCapture = vi.hoisted(() => ({ panels: [] }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useState: (initial) => {
      const index = panelHookState.cursor++;
      if (!(index in panelHookState.slots))
        panelHookState.slots[index] = { value: typeof initial === "function" ? initial() : initial };
      const slot = panelHookState.slots[index];
      return [slot.value, (value) => { slot.value = typeof value === "function" ? value(slot.value) : value; }];
    },
    useRef: (initial) => {
      const index = panelHookState.cursor++;
      if (!(index in panelHookState.slots)) panelHookState.slots[index] = { value: { current: initial } };
      return panelHookState.slots[index].value;
    },
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  };
});
vi.mock("./ai-recommendation-panel", () => ({
  AiRecommendationPanel: (props) => {
    panelCapture.panels.push(props);
    return null;
  },
}));
import { DispatchPlanPanel } from "./dispatch-plan-panel";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EvidenceDrawer, EvidenceFailureMessage, EligibilityInspector } from "./evidence-drawer";

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

  it("does not classify an incomplete verified pair as ready", () => {
    const partialProposal = {
      pair: safePair,
      outcome: "VERIFIED",
      candidateEvaluationComplete: false,
    };
    expect(bucketProposal(partialProposal, Date.now())).toBe("Not evaluated");
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

import { queuePresentation } from "@/lib/dispatch/queue-presentation";
import { statusVariant } from "@/components/ui/status-badge";

describe("queue presentation StatusBadge tones", () => {
  it("keeps unevaluated requests neutral instead of showing healthy green", () => {
    const badge = queuePresentation({ fleet_status: "Scheduled" }, "Not evaluated");
    expect(statusVariant(badge.status, badge.entity)).toBe("secondary");
  });

  it("keeps verified ready and missing evidence visibly distinct", () => {
    const ready = queuePresentation({ fleet_status: "Scheduled" }, "Ready for confirmation");
    const verification = queuePresentation({ fleet_status: "Scheduled" }, "Needs verification");

    expect(ready.label).toBe("Ready");
    expect(statusVariant(ready.status, ready.entity)).toBe("success");
    expect(verification.label).toBe("Needs verification");
    expect(statusVariant(verification.status, verification.entity)).toBe("warning");
  });
});

const findTreeNode = (node, predicate) => {
  if (Array.isArray(node)) return node.map((child) => findTreeNode(child, predicate)).find(Boolean) ?? null;
  if (!React.isValidElement(node)) return null;
  if (predicate(node)) return node;
  return findTreeNode(node.props?.children, predicate);
};
const countTreeNodes = (node, predicate) => {
  if (Array.isArray(node)) return node.reduce((n, child) => n + countTreeNodes(child, predicate), 0);
  if (!React.isValidElement(node)) return 0;
  return (predicate(node) ? 1 : 0) + countTreeNodes(node.props?.children, predicate);
};
const treeText = (node) => {
  if (Array.isArray(node)) return node.map(treeText).join(" ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!React.isValidElement(node)) return "";
  return treeText(node.props?.children);
};
const panelTree = (props = {}) => {
  panelHookState.slots = [];
  panelHookState.cursor = 0;
  panelCapture.panels = [];
  return DispatchPlanPanel({
    selectedRequest: { request_id: 901 },
    planHook: null,
    isDesktop: true,
    isMobileDrawerOpen: false,
    ...props,
  });
};

describe("DispatchPlanPanel single mounted body (Task 6)", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("mounts exactly one decision body in the desktop aside and no dialog", () => {
    const tree = panelTree({ isDesktop: true });
    expect(findTreeNode(tree, (node) => node.type === "aside")).not.toBeNull();
    expect(findTreeNode(tree, (node) => node.type === Dialog)).toBeNull();
    expect(countTreeNodes(tree, (node) => node.type?.name === "AiRecommendationPanel")).toBe(1);
  });

  it("mounts nothing while the narrow drawer stays closed", () => {
    expect(panelTree({ isDesktop: false, isMobileDrawerOpen: false })).toBeNull();
  });

  it("mounts exactly one decision body in the narrow drawer", () => {
    const tree = panelTree({ isDesktop: false, isMobileDrawerOpen: true });
    expect(findTreeNode(tree, (node) => node.type === Dialog)).not.toBeNull();
    expect(findTreeNode(tree, (node) => node.type === "aside")).toBeNull();
    expect(countTreeNodes(tree, (node) => node.type?.name === "AiRecommendationPanel")).toBe(1);
  });

  it("freezes a busy operation's presentation when the width crosses the threshold", () => {
    let tree = panelTree({ isDesktop: false, isMobileDrawerOpen: true });
    const body = findTreeNode(tree, (node) => node.type?.name === "AiRecommendationPanel");
    expect(body).not.toBeNull();
    // A recheck/assignment starts while narrow: the drawer presentation locks.
    body.props.onBusyChange(true);
    // Width now measures wide mid-commit: the drawer stays, no aside appears,
    // so the in-flight operation is never unmounted mid-commit.
    panelHookState.cursor = 0;
    tree = DispatchPlanPanel({
      selectedRequest: { request_id: 901 },
      planHook: null,
      isDesktop: true,
      isMobileDrawerOpen: true,
    });
    expect(findTreeNode(tree, (node) => node.type === Dialog)).not.toBeNull();
    expect(findTreeNode(tree, (node) => node.type === "aside")).toBeNull();
    expect(countTreeNodes(tree, (node) => node.type?.name === "AiRecommendationPanel")).toBe(1);
    // Once the operation resolves the presentation follows the measured width.
    const busyBody = findTreeNode(tree, (node) => node.type?.name === "AiRecommendationPanel");
    busyBody.props.onBusyChange(false);
    panelHookState.cursor = 0;
    tree = DispatchPlanPanel({
      selectedRequest: { request_id: 901 },
      planHook: null,
      isDesktop: true,
      isMobileDrawerOpen: true,
    });
    expect(findTreeNode(tree, (node) => node.type === "aside")).not.toBeNull();
    expect(findTreeNode(tree, (node) => node.type === Dialog)).toBeNull();
  });

  it("sizes the drawer Close control to 44px without an undeclared Button size", () => {
    const tree = panelTree({ isDesktop: false, isMobileDrawerOpen: true });
    const close = findTreeNode(
      tree,
      (node) => node.type === Button && treeText(node.props.children).includes("Close")
    );
    expect(close).not.toBeNull();
    expect(close.props.size).not.toBe("xs");
    expect(String(close.props.className)).toContain("min-h-[44px]");
  });
});

describe("evidence drawer operator targets (Task 6)", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sizes the evidence Close and Back controls to 44px", () => {
    panelHookState.slots = [];
    panelHookState.cursor = 0;
    const tree = EvidenceDrawer({
      requestId: 901,
      proof: { type: "leave", ref: "ev_x" },
      backTo: { kind: "inspector" },
      onClose: () => {},
      onBack: () => {},
    });
    const close = findTreeNode(
      tree,
      (node) => node.type === "button" && treeText(node.props.children).includes("Close evidence") === false && treeText(node.props.children) === "Close"
    );
    expect(close).not.toBeNull();
    expect(String(close.props.className)).toContain("min-h-[44px]");
    const back = findTreeNode(
      tree,
      (node) => node.type === "button" && treeText(node.props.children).includes("Back to checklist")
    );
    expect(back).not.toBeNull();
    expect(String(back.props.className)).toContain("min-h-[44px]");
  });

  it("sizes the inspector Review control to 44px", () => {
    const html = renderToStaticMarkup(
      React.createElement(EligibilityInspector, {
        pairLabel: "ABC-1234 + Maria Santos",
        horizon: "FUTURE",
        rows: [{ label: "Capacity", state: "clear", note: "No blocking issue found", proof: { type: "capacity", ref: "ev_1" } }],
        onReviewProof: () => {},
      })
    );
    expect(html).toContain("Review");
    expect(html).toContain("min-h-[44px]");
  });

  it("sizes the evidence failure Retry/Close controls to 44px", () => {
    const html = renderToStaticMarkup(
      React.createElement(EvidenceFailureMessage, {
        error: new Error("snapshot fetch failed"),
        onRetry: () => {},
        onClose: () => {},
      })
    );
    expect(html).toContain("min-h-[44px]");
  });
});
