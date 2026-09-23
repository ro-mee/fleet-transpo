"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, ExternalLink, Loader2, MapPin, Plus, Route as RouteIcon } from "lucide-react";
import { DataTable } from "@/components/tables/data-table";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { can, useRequireRole } from "@/lib/auth/role-guard";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { formatStructuredAddress } from "@/lib/address/structured";
import { AddressFormDialog } from "@/components/address/address-form-dialog";
import { createLocation, getLocations, updateLocation } from "@/services/location.service";
import { isGoogleMapsUrl, parseGoogleMapsCoordinates } from "@/lib/google-maps";

function coordinateRule(label, min, max) {
  return (value) => {
    if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
      return `${label} must be a number between ${min} and ${max}.`;
    }
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max
      ? null
      : `${label} must be a number between ${min} and ${max}.`;
  };
}

const locationSchema = {
  name: { required: true, maxLength: 255, label: "Location name", validate: (value) => typeof value === "string" ? null : "Location name must be text." },
  // No `address` rule any more. The address is not typed here — it is picked
  // through the cascade, and the server composes the stored text from its own
  // resolution of the barangay code. What replaces the old `required: true` is
  // the explicit check in `submitForm`.
  maps_url: { maxLength: 2000, label: "Google Maps link", validate: (value) => !String(value || "").trim() || isGoogleMapsUrl(String(value).trim()) ? null : "Google Maps link must be a valid Google Maps URL." },
  latitude: { label: "Latitude", validate: coordinateRule("Latitude", -90, 90) },
  longitude: { label: "Longitude", validate: coordinateRule("Longitude", -180, 180) },
};

// `address` is deliberately absent: the picked address lives in its own state
// (`addressValue`), and the legacy text of the record being edited is read from
// `editingLocation` directly. Mirroring it into this form object would give two
// copies of one address and a way for them to disagree.
const EMPTY_LOCATION = { name: "", maps_url: "", latitude: "", longitude: "" };

function formatCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(7).replace(/0+$/, "").replace(/\.$/, "") : "Unavailable";
}

function mapUrl(location) {
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

export default function LocationsPage() {
  const { authorized } = useRequireRole();
  const { employee } = useAuth();
  const queryClient = useQueryClient();
  const canCreate = can(employee, "routes", "create");
  const canUpdate = can(employee, "routes", "update");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null);
  const [formData, setFormData] = useState(EMPTY_LOCATION);
  const [formError, setFormError] = useState(null);
  /** The picked structured address, or null when the operator has not picked one. */
  const [addressValue, setAddressValue] = useState(null);
  /**
   * The cascade dialog. It and the location form are mutually exclusive — see
   * the comment on the location `Dialog` below.
   */
  const [pickOpen, setPickOpen] = useState(false);
  const { validate, fieldError, registerField, resetValidation } = useFormValidation(locationSchema);
  const linkedCoordinates = useMemo(() => parseGoogleMapsCoordinates(formData.maps_url), [formData.maps_url]);

  /**
   * What the address field shows: the pick in hand, or — when editing a record
   * that predates the cascade — the legacy text it already carries. Never both,
   * and never a composed guess at the structured detail behind legacy text.
   */
  const displayAddress = addressValue
    ? formatStructuredAddress(addressValue)
    : editingLocation?.address || "";

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: getLocations,
    enabled: authorized,
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, ...location }) => id ? updateLocation(id, location) : createLocation(location),
    onSuccess: (location) => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      setDialogOpen(false);
      setEditingLocation(null);
      setAddressValue(null);
      setFormError(null);
      toast.success(location.versioned ? "Location version created; historical routes are preserved" : editingLocation ? "Location updated" : "Canonical location added");
    },
    onError: (error) => setFormError(error.message),
  });

  function openNew() {
    setEditingLocation(null);
    setFormData({ ...EMPTY_LOCATION });
    setAddressValue(null);
    setPickOpen(false);
    setFormError(null);
    resetValidation();
    setDialogOpen(true);
  }

  const openEdit = useCallback((location) => {
    setEditingLocation(location);
    setFormData({
      name: location.name || "",
      maps_url: "",
      latitude: location.latitude ?? "",
      longitude: location.longitude ?? "",
    });
    // Cleared, not pre-filled. The list carries `address_id` but not the
    // address detail behind it, and reconstructing a barangay code from stored
    // TEXT is the fuzzy name match this whole design refuses. The current
    // address stays on screen read-only; picking a new one replaces it.
    setAddressValue(null);
    setPickOpen(false);
    setFormError(null);
    resetValidation();
    setDialogOpen(true);
  }, [resetValidation]);

  function submitForm(event) {
    event.preventDefault();
    setFormError(null);
    const hasLatitude = String(formData.latitude).trim() !== "";
    const hasLongitude = String(formData.longitude).trim() !== "";
    const isValid = validate(formData);
    if (!isValid) return;
    // The replacement for the old `address: { required: true }`. Either the
    // operator picks one now, or the record already has one that this edit is
    // leaving alone — there is no third state in which a location saves with no
    // address, which is what the API enforcement below also says.
    if (!addressValue && !editingLocation?.address) {
      setFormError("Pick an address from the Philippine address cascade.");
      return;
    }
    if (hasLatitude !== hasLongitude) {
      setFormError("Enter both coordinates, or provide a Google Maps link.");
      return;
    }
    if (!formData.maps_url.trim() && !hasLatitude) {
      setFormError("Provide a Google Maps link or enter both coordinates.");
      return;
    }

    const payload = {
      name: formData.name.trim(),
      maps_url: formData.maps_url.trim() || undefined,
      // Sent ONLY when the operator actually picked one. Omitting it is what
      // tells the API to leave both the stored text and its registry row as they
      // are, which is what makes a rename not silently drop the address.
      structured_address: addressValue ?? undefined,
    };
    if (hasLatitude && hasLongitude) {
      payload.latitude = Number(formData.latitude);
      payload.longitude = Number(formData.longitude);
    }
    saveMutation.mutate({ id: editingLocation?.location_id, ...payload });
  }

  const columns = useMemo(() => [
    {
      key: "name",
      label: "Location",
      sortable: true,
      render: (value, location) => <div><p className="font-semibold text-foreground">{value}</p><p className="mt-0.5 font-data text-[11px] text-foreground-muted">Canonical location #{location.location_id}</p></div>,
    },
    {
      key: "address",
      label: "Address",
      sortable: true,
      render: (value) => <p className="max-w-md whitespace-normal text-foreground-secondary">{value || "Address not recorded"}</p>,
    },
    {
      key: "latitude",
      label: "Coordinates",
      render: (_, location) => <div className="font-data text-xs"><p>Lat {formatCoordinate(location.latitude)}</p><p className="mt-0.5 text-foreground-muted">Lng {formatCoordinate(location.longitude)}</p></div>,
    },
    {
      key: "longitude",
      label: "Navigation",
      render: (_, location) => {
        const href = mapUrl(location);
        return href
          ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">Verify pin<ExternalLink className="h-3.5 w-3.5" /></a>
          : <Badge variant="warning">Coordinates unavailable</Badge>;
      },
    },
    ...(canUpdate ? [{
      key: "location_id",
      label: "Actions",
      render: (_, location) => <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => openEdit(location)}><Edit3 className="mr-1.5 h-3.5 w-3.5" />Edit</Button>,
    }] : []),
  ], [canUpdate, openEdit]);

  if (locationsQuery.isError) {
    return <div className="space-y-6"><HeroHeader icon={MapPin} title="Location Management" badge="Operations" description="Canonical endpoints used by routes and navigation." /><EmptyState icon={MapPin} title="Could not load locations" description={locationsQuery.error?.message || "The location registry could not be read."} action={<Button onClick={() => locationsQuery.refetch()}>Try again</Button>} /></div>;
  }

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={MapPin}
        title="Location Management"
        badge="Operations"
        description="Create and verify canonical endpoints before connecting them with directional routes."
        actions={<>
          <Button variant="outline" className={cn("h-10", heroButtonOutlineClass)} asChild><Link href="/routes"><RouteIcon className="mr-2 h-4 w-4" />Back to routes</Link></Button>
          {canCreate && <Button className={cn("h-10", heroButtonPrimaryClass)} onClick={openNew}><Plus className="mr-2 h-4 w-4" />Add location</Button>}
        </>}
      />

      <DataTable
        columns={columns}
        data={locationsQuery.data || []}
        title="Canonical location registry"
        description="Names, addresses, and exact coordinates used by route estimates and live navigation."
        icon={MapPin}
        searchPlaceholder="Search location or address..."
        emptyTitle="No canonical locations yet"
        emptyDescription="Add a verified location before creating a reusable route."
        emptyVariant="first-run"
        emptyAction={canCreate ? <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Add location</Button> : null}
        isLoading={locationsQuery.isLoading}
        stickyFirstColumn
      />

      {/* The picker and this form are MUTUALLY EXCLUSIVE: opening the cascade
          closes this dialog, and finishing or cancelling opens it again. Both
          are Radix dialogs, and leaving both mounted would stack two
          `bg-black/60` overlays and two focus traps over one another for no
          gain — the form's state lives in this component, not in the dialog, so
          nothing is lost by unmounting it for the detour. */}
      <Dialog open={dialogOpen && !pickOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setFormError(null); setEditingLocation(null); } }}>
        <DialogContent className="max-w-lg w-[95vw]">
          <DialogHeader>
            <DialogTitle>{editingLocation ? "Edit canonical location" : "Add canonical location"}</DialogTitle>
            <DialogDescription>{editingLocation ? "Name and address changes keep this location identity. A coordinate change used by trip history creates a new version instead." : "Use a distinct operational name and verify the pin before saving. Airport arrivals and departures should be separate endpoints."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} className="space-y-4 p-6 pt-5">
            <div className="space-y-1.5">
              <Label htmlFor="location_name">Location name</Label>
              <Input id="location_name" value={formData.name} onChange={(event) => setFormData((previous) => ({ ...previous, name: event.target.value }))} ref={registerField("name")} invalid={fieldError("name").invalid} placeholder="Enter the official location name" maxLength={255} autoFocus />
              {fieldError("name").error && <p className="text-xs text-danger">{fieldError("name").error}</p>}
            </div>
            {/* The address is picked, not typed. The operator chooses a barangay
                and the server derives the rest of the hierarchy from that code,
                so what is stored is structurally valid by construction rather
                than a string nothing can check. */}
            <div className="space-y-1.5">
              {/* `htmlFor` points at the button, not at a text box: a `<label>`
                  with nothing to label is announced as an orphan, and the
                  button is the only control in this field. */}
              <Label htmlFor="location_address_pick">Address</Label>
              <div className="flex items-start gap-2">
                <div className="min-h-10 flex-1 rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
                  {displayAddress ? (
                    <p className="text-xs font-semibold leading-relaxed text-foreground-secondary">{displayAddress}</p>
                  ) : (
                    <p className="text-xs text-foreground-muted">No address picked yet.</p>
                  )}
                </div>
                <Button
                  id="location_address_pick"
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0"
                  onClick={() => setPickOpen(true)}
                >
                  <MapPin className="mr-1.5 h-4 w-4" />
                  {displayAddress ? "Replace address" : "Pick address"}
                </Button>
              </div>
              {addressValue && (
                <p className="text-xs text-success-700">
                  Picked from the Philippine address cascade. Saving replaces this location&rsquo;s stored address.
                </p>
              )}
              {!addressValue && editingLocation?.address_id && (
                <p className="text-xs text-foreground-muted">
                  This address predates the cascade. It is shown as stored and stays unchanged unless you pick a new one.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location_maps_url">Google Maps link</Label>
              <Input id="location_maps_url" type="url" value={formData.maps_url} onChange={(event) => setFormData((previous) => ({ ...previous, maps_url: event.target.value, ...(event.target.value.trim() ? { latitude: "", longitude: "" } : {}) }))} ref={registerField("maps_url")} invalid={fieldError("maps_url").invalid} placeholder="Paste the link to the dropped pin" maxLength={2000} />
              {fieldError("maps_url").error && <p className="text-xs text-danger">{fieldError("maps_url").error}</p>}
              {formData.maps_url.trim() && linkedCoordinates && <p className="text-xs text-success-700">Coordinates found: <span className="font-data">{formatCoordinate(linkedCoordinates.latitude)}, {formatCoordinate(linkedCoordinates.longitude)}</span></p>}
              {formData.maps_url.trim() && !linkedCoordinates && !fieldError("maps_url").error && <p className="text-xs text-foreground-muted">The link will be resolved when saved. If it is a shortened link without a pin, use the manual fallback below.</p>}
            </div>
            <details className="rounded-xl border border-border/70 bg-muted/20 p-3" open={!formData.maps_url.trim() || !linkedCoordinates}>
              <summary className="cursor-pointer text-xs font-semibold text-foreground-secondary">Manual coordinate fallback</summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="location_latitude">Latitude</Label>
                  <Input id="location_latitude" type="number" step="any" min="-90" max="90" value={formData.latitude} onChange={(event) => setFormData((previous) => ({ ...previous, latitude: event.target.value }))} ref={registerField("latitude")} invalid={fieldError("latitude").invalid} placeholder="Decimal degrees" />
                  {fieldError("latitude").error && <p className="text-xs text-danger">{fieldError("latitude").error}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="location_longitude">Longitude</Label>
                  <Input id="location_longitude" type="number" step="any" min="-180" max="180" value={formData.longitude} onChange={(event) => setFormData((previous) => ({ ...previous, longitude: event.target.value }))} ref={registerField("longitude")} invalid={fieldError("longitude").invalid} placeholder="Decimal degrees" />
                  {fieldError("longitude").error && <p className="text-xs text-danger">{fieldError("longitude").error}</p>}
                </div>
              </div>
            </details>
            <p className="text-xs text-foreground-muted">Coordinates are saved to seven decimal places and become the source for TomTom estimates and live navigation. The system blocks duplicate active names after trimming case and spacing differences.</p>
            {formError && <p role="alert" className="text-sm font-semibold text-danger">{formError}</p>}
            <DialogFooter className="-mx-6 -mb-6 border-t border-border/60"><Button type="button" variant="outline" disabled={saveMutation.isPending} onClick={() => setDialogOpen(false)}>Cancel</Button><Button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editingLocation ? "Save changes" : "Add location"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* The cascade, as its own dialog rather than a section of the form above.
          `showPinMap={false}` because the LOCATION owns the pin — it has one
          already, from the Maps link or the manual fields. Two coordinate pairs
          for one place would be two things to keep in step, and the stale-value
          hazard that creates is the one the address work exists to remove. One
          point, one owner.
          `showTypeSelector={false}` because home / office / other describes a
          PERSON's address; a canonical location is neither, and defaulting it to
          "home" would store a claim nobody made. See the dialog for where it
          lands instead.
          `initialValue` is the pick in hand, so reopening after a change starts
          from what was chosen rather than from blank. */}
      <AddressFormDialog
        open={pickOpen}
        onOpenChange={setPickOpen}
        initialValue={addressValue ?? undefined}
        showPinMap={false}
        showTypeSelector={false}
        title={addressValue ? "Replace address" : "Pick address"}
        description="Choose the region, province, city or municipality, and barangay, then add the street detail. The full hierarchy is resolved by the server when you save."
        submitLabel="Use this address"
        onSubmit={(next) => {
          setAddressValue(next);
          setPickOpen(false);
        }}
      />
    </div>
  );
}
