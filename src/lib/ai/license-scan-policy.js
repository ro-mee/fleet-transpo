export function evaluateLicenseScan(side, extractedData = {}, { todayIso } = {}) {
  if (side !== "front" && side !== "back") {
    return { pass: false, validationIssue: "Unknown license side.", applyExpiry: false, expiryDate: null };
  }

  if (extractedData.document_is_license_card !== true) {
    return {
      pass: false,
      validationIssue:
        "This photo does not look like a Philippine LTO driver's license card. Please retake the actual card — full card in frame, no printed copies or screenshots.",
      applyExpiry: false,
      expiryDate: null,
    };
  }

  const hasKeyFields =
    side === "back"
      ? Boolean(extractedData.emergency_contact_name || extractedData.emergency_contact_phone)
      : Boolean(extractedData.license_number || extractedData.last_name);

  if (!hasKeyFields) {
    return {
      pass: false,
      validationIssue:
        "Could not read the license photo clearly. Please retake with better lighting and keep the card flat and fully in frame.",
      applyExpiry: false,
      expiryDate: null,
    };
  }

  const today = todayIso || new Date().toISOString().slice(0, 10);
  let applyExpiry = false;
  let expiryDate = null;
  if (side === "front" && extractedData.expiration_date && extractedData.expiration_date > today) {
    applyExpiry = true;
    expiryDate = extractedData.expiration_date;
  }

  return { pass: true, validationIssue: null, applyExpiry, expiryDate };
}
