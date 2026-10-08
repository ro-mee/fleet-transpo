const asCount = (value) => Math.max(0, Number(value) || 0);

export function getPermitReceiptState(request) {
  const activeCount = asCount(request?.active_receipt_count);
  const archivedCount = asCount(request?.archived_receipt_count);
  const activeStatuses = Array.isArray(request?.active_receipt_statuses)
    ? [...new Set(request.active_receipt_statuses.filter(Boolean))]
    : [];

  if (activeCount === 1 && activeStatuses.length === 1) {
    let state;
    switch (activeStatuses[0]) {
      case "Approved":
        state = { label: "Approved receipt", detail: "Included in Fuel Analytics." };
        break;
      case "Pending":
        state = { label: "Pending review", detail: "Not included in Fuel Analytics yet." };
        break;
      case "Rejected":
        state = { label: "Rejected receipt", detail: "Excluded from Fuel Analytics." };
        break;
      case "Completed":
        state = { label: "Completed receipt", detail: "Fuel Analytics currently counts Approved records only." };
        break;
      default:
        state = { label: "Active receipt", detail: "Check its status for analytics eligibility." };
    }
    if (archivedCount > 0) {
      const noun = archivedCount === 1 ? "receipt is" : "receipts are";
      state.detail += ` ${archivedCount} archived ${noun} also linked.`;
    }
    return state;
  }

  if (activeCount > 0) {
    return {
      label: activeCount === 1 ? "Active receipt" : `${activeCount} active receipts`,
      detail: activeStatuses.length
        ? `Active statuses: ${activeStatuses.join(", ")}. Review each record for analytics eligibility.${archivedCount > 0 ? ` ${archivedCount} archived receipt${archivedCount === 1 ? " is" : "s are"} also linked.` : ""}`
        : `Review the linked records for analytics eligibility.${archivedCount > 0 ? ` ${archivedCount} archived receipt${archivedCount === 1 ? " is" : "s are"} also linked.` : ""}`,
    };
  }

  if (archivedCount > 0) {
    return {
      label: archivedCount === 1 ? "Receipt archived" : `${archivedCount} receipts archived`,
      detail: "Archived receipts are excluded from the active registry and Fuel Analytics.",
    };
  }

  if (request?.status === "Fulfilled") {
    return {
      label: "No active receipt found",
      detail: "This fulfilled permit has no linked fuel record available.",
    };
  }

  if (request?.status === "Approved") {
    return {
      label: "Awaiting receipt",
      detail: "The permit is authorized; consumption is recorded after refueling.",
    };
  }

  return {
    label: "No receipt yet",
    detail: "A fuel record is created when refueling is submitted.",
  };
}
