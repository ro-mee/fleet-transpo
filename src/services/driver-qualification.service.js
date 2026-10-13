// Ledger migration 162 retired the separate qualification roster. Persisted
// driver_type is checked by vehicle-load-compatibility; it is not a substitute
// approval for the removed service-policy model.
const retired = () => { throw Object.assign(new Error('The service qualification roster is retired. Use the saved driver classification; service-policy approval is unavailable.'), {
  status: 503, code: 'QUALIFICATION_ROSTER_RETIRED',
}); };

export async function loadDriverQualifications() { return retired(); }
export async function setDriverQualification() { return retired(); }
