"use client";

// The structured address behind a saved location, loaded so the picker can
// reopen on it.
//
// WHY THIS IS LAZY RATHER THAN PART OF THE LIST
// ---------------------------------------------
// The detail is a re-resolved PSGC chain: a barangay code looked up against four
// tables. Doing that for every row of a list, to populate a form that is almost
// always closed, is the N+1 this hook exists to avoid. It fetches for the ONE row
// being edited, and only once its dialog is open.
//
// WHY IT ASKS THE LOCATION ROUTE AND NOT THE DRIVER ONE
// -----------------------------------------------------
// A location already has its own read path with its own permission gate, so the
// detail rides on that rather than on a new endpoint with a new permission — see
// `GET /api/locations/[id]`. The driver surfaces get theirs from
// `GET /api/drivers/[id]` for the same reason, and the caller there already holds
// the value, so no hook is needed.
//
// A FAILURE IS NOT AN ERROR HERE
// ------------------------------
// `reason` distinguishes the loader's four outcomes, and only `unavailable` means
// something went wrong for us. The others are ordinary states — `no-address-id`
// is every location that predates the registry, `no-psgc-code` is every address
// saved before the cascade. None of them should stop the dialog from opening, so
// none of them throws; the caller shows the reason inline.
//
// `staleTime: 0` is deliberate: the address may have been changed on another
// surface since the list was fetched, and reopening the picker is exactly when
// the operator wants what is there NOW, not what was there at mount.

import { useQuery } from "@tanstack/react-query";
import { getLocation } from "@/services/location.service";

/**
 * @param {number|string|null|undefined} locationId
 * @param {boolean} enabled  whether to fetch at all — pass the dialog's `open`
 * @returns {{value: object|null, reason: string|null, loading: boolean}}
 */
export function useStructuredAddress(locationId, enabled) {
  const { data, isFetching } = useQuery({
    queryKey: ["location", locationId, "structured-address"],
    queryFn: () => getLocation(locationId),
    enabled: Boolean(enabled && locationId),
    staleTime: 0,
  });

  return {
    value: data?.structured_address ?? null,
    // Null while loading, so the field does not flash a refusal it has not
    // established yet. A location with no address simply resolves to
    // `no-address-id` once the fetch lands.
    reason: data ? (data.structured_address_reason ?? null) : null,
    loading: isFetching,
  };
}

export default useStructuredAddress;
