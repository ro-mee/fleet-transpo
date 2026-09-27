/** A late lookup may update the form only while it still owns the current query. */
export function isCurrentAddressLookup({
  requestedQuery,
  currentQuery,
  requestController,
  activeController,
}) {
  return requestedQuery === currentQuery && requestController === activeController;
}
