"use client";

import { useQuery } from "@tanstack/react-query";
import { Building, Building2, MapPin, MapPinned } from "lucide-react";
import {
  getBarangays,
  getCities,
  getProvinces,
  getRegions,
} from "@/services/geography.service";
import { regionRequiresProvince, selectLevel } from "@/lib/address/structured";
import { SearchableSelect } from "./searchable-select";

// The Region → Province → City/Municipality → Barangay cascade.
//
// ONE REQUEST PER LEVEL, FILTERED CLIENT-SIDE. This is the shape the data asks
// for: 17 regions, ~10 provinces per region, tens of cities per province, and
// tens-to-hundreds of barangays per city. Each answer is small enough to send
// whole, so the type-to-filter in each dropdown runs over an array already in
// memory — no request per keystroke, and the ~42,000-row barangay table never
// ships to the browser at once.
//
// WHY REACT QUERY RATHER THAN useEffect + fetch. Three reasons, all of them
// things the hand-rolled version gets wrong: a slow "Cebu" response cannot land
// after a fast "Laguna" one and overwrite it (the cache key includes the parent
// code); re-opening the form for the same region does not refetch; and there is
// no effect that sets state, which is the pattern this repo lints against.
//
// THE METRO MANILA CASE, WHICH IS THE ONE THAT BREAKS NAIVE CASCADES. NCR has no
// provinces. A cascade that always waits for a province leaves the City dropdown
// disabled forever and makes every Manila address unsaveable. `requiresProvince`
// is derived from the PROVINCE LIST ITSELF — not from a hardcoded region code —
// so when a region turns out to have none, the city list loads off `?region=` and
// the province field explains itself instead of sitting there refusing input.
// Until the list actually arrives the answer is "required", because guessing the
// other way would let a half-filled address render as complete.

/** Geography is reference data; it changes only when someone runs the importer. */
const GEO_STALE_TIME = 5 * 60 * 1000;

/**
 * Whether a region requires a province, for callers that need the answer without
 * rendering the cascade — the dialog's completeness check and its submit payload
 * both do.
 *
 * Deliberately the SAME query key the cascade uses, so react-query serves one
 * request to both. Restating the derivation in the dialog is how the Save button
 * and the Province field end up disagreeing about Metro Manila.
 *
 * @param {string|null} regionCode
 * @returns {boolean}
 */
export function useProvinceRequirement(regionCode) {
  const provincesQuery = useQuery({
    queryKey: ["geo-provinces", regionCode],
    queryFn: () => getProvinces(regionCode),
    enabled: Boolean(regionCode),
    staleTime: GEO_STALE_TIME,
  });

  return regionRequiresProvince(
    provincesQuery.data ?? [],
    // `isSuccess` rather than "not loading": an errored request must not read as
    // an empty list, or a network failure would silently drop the province.
    Boolean(regionCode) && provincesQuery.isSuccess
  );
}

export function LocationCascade({ value, onChange, errors = {}, disabled = false }) {
  const regionsQuery = useQuery({
    queryKey: ["geo-regions"],
    queryFn: getRegions,
    staleTime: GEO_STALE_TIME,
  });

  const provincesQuery = useQuery({
    queryKey: ["geo-provinces", value.regionCode],
    queryFn: () => getProvinces(value.regionCode),
    enabled: Boolean(value.regionCode),
    staleTime: GEO_STALE_TIME,
  });

  const provinces = provincesQuery.data ?? [];
  // `isSuccess` rather than "not loading": an errored request must not be read as
  // an empty list, or a network failure would silently make the province optional.
  const provincesLoaded = Boolean(value.regionCode) && provincesQuery.isSuccess;
  const requiresProvince = regionRequiresProvince(provinces, provincesLoaded);

  // The province-less regions load their cities off the region instead. This is a
  // different path through the same endpoint, not a fallback.
  const citiesByRegion = value.regionCode && provincesLoaded && !requiresProvince;

  const citiesQuery = useQuery({
    queryKey: [
      "geo-cities",
      citiesByRegion ? null : value.provinceCode,
      citiesByRegion ? value.regionCode : null,
    ],
    queryFn: () =>
      getCities(
        citiesByRegion
          ? { regionCode: value.regionCode }
          : { provinceCode: value.provinceCode }
      ),
    enabled: Boolean(value.regionCode) && (citiesByRegion || Boolean(value.provinceCode)),
    staleTime: GEO_STALE_TIME,
  });

  const barangaysQuery = useQuery({
    queryKey: ["geo-barangays", value.cityCode],
    queryFn: () => getBarangays(value.cityCode),
    enabled: Boolean(value.cityCode),
    staleTime: GEO_STALE_TIME,
  });

  function handleRegion(code, option) {
    onChange(selectLevel(value, "region", { regionCode: code, regionName: option.name }));
  }

  function handleProvince(code, option) {
    onChange(selectLevel(value, "province", { provinceCode: code, provinceName: option.name }));
  }

  function handleCity(code, option) {
    // `cityHasNoProvince` is recorded HERE, at the moment the city is chosen,
    // because this is the only point where the answer is known. It is what makes
    // the composed address skip the province line later, and what the server
    // checks the submitted province against.
    onChange(
      selectLevel(value, "city", {
        cityCode: code,
        cityName: option.name,
        cityHasNoProvince: !requiresProvince,
      })
    );
  }

  function handleBarangay(code, option) {
    onChange(selectLevel(value, "barangay", { barangayCode: code, barangayName: option.name }));
  }

  const provinceSkipped = Boolean(value.regionCode) && provincesLoaded && !requiresProvince;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SearchableSelect
        id="address-region"
        label="Region"
        icon={MapPinned}
        required
        disabled={disabled}
        value={value.regionCode}
        valueLabel={value.regionName}
        onChange={handleRegion}
        options={regionsQuery.data ?? []}
        loading={regionsQuery.isLoading}
        error={errors.region}
        placeholder="Select region"
        loadingMessage="Loading regions…"
        emptyDescription="No regions are loaded yet. Run the PSGC import to populate the geography tables."
      />

      <SearchableSelect
        id="address-province"
        label="Province"
        icon={MapPin}
        // Required only when this region actually has provinces. The asterisk
        // tracks the same flag the Save button does, so the two cannot disagree.
        required={requiresProvince}
        // Disabled until a region is chosen, and disabled again once we know the
        // region has no provinces — in that case the placeholder explains why
        // rather than leaving an inert control with no reason given.
        disabled={disabled || !value.regionCode || provinceSkipped}
        value={provinceSkipped ? null : value.provinceCode}
        valueLabel={value.provinceName}
        onChange={handleProvince}
        options={provinces}
        loading={Boolean(value.regionCode) && provincesQuery.isLoading}
        error={provinceSkipped ? undefined : errors.province}
        placeholder={provinceSkipped ? "Not applicable — this region has no provinces" : "Select province"}
        hint={provinceSkipped ? "Metro Manila and the independent cities sit directly under their region." : undefined}
        loadingMessage="Loading provinces…"
        emptyDescription="No provinces match this region."
      />

      <SearchableSelect
        id="address-city"
        label="City / Municipality"
        icon={Building2}
        required
        disabled={
          disabled || !value.regionCode || (requiresProvince && !value.provinceCode)
        }
        value={value.cityCode}
        valueLabel={value.cityName}
        onChange={handleCity}
        options={citiesQuery.data ?? []}
        loading={citiesQuery.isLoading}
        error={errors.city}
        placeholder="Select city or municipality"
        loadingMessage="Loading cities…"
        emptyDescription="No cities are loaded for this selection yet."
      />

      <SearchableSelect
        id="address-barangay"
        label="Barangay"
        icon={Building}
        required
        disabled={disabled || !value.cityCode}
        value={value.barangayCode}
        valueLabel={value.barangayName}
        onChange={handleBarangay}
        options={barangaysQuery.data ?? []}
        loading={barangaysQuery.isLoading}
        error={errors.barangay}
        placeholder="Select barangay"
        loadingMessage="Loading barangays…"
        emptyDescription="No barangays are loaded for this city yet."
      />
    </div>
  );
}
