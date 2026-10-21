import React from "react";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import * as viewModel from "./cargo-view-model";
import * as drawing from "./cargo-signature";
import { resolveDriverWorkspace } from "./driver-workspace";

async function workflow({ pending = false } = {}) {
  const state = [], refs = [], queued = [], depsSeen = [], cleanups = [];
  let cursor = 0, rc = 0, ec = 0, focused;
  const react = { ...React, useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; }, useRef(initial) { return refs[rc++] ||= { current: initial }; }, useCallback: fn => fn, useEffect(fn, deps) { const i = ec++; if (!depsSeen[i] || deps.some((value, j) => value !== depsSeen[i][j])) { depsSeen[i] = deps; queued.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } }, createElement: (component, props, ...children) => ({ component, props: props || {}, children }) };
  const session = { actorId: "12", generation: 1 }, current = { actor: "12", type: "Cargo", online: true, tripId: "701", session };
  const ref = { kind: "REQUEST", id: "manifest-1", revision: 1, hash: "a".repeat(64) };
  const execution = { manifest: { manifest_ref: ref, service_code: "HOTEL_SUPPLY_TRANSFER", lines: [{ line_id: "boxes", name: "Supplies", expected_quantity: "10", unit: "boxes", quantity_basis: "TRANSPORT_PACKAGE" }] }, capabilities: { observe: true }, lines: [] };
  const trip = { trip_id: 701, driver_id: 3, vehicle_id: 7, operational_use: "Cargo", load_type: "Cargo", trip_status: "At Pickup" };
  const form = { counts: { boxes: "10" }, issues: {}, manifestHash: ref.hash, ...(pending ? { pendingSubmissionId: "saved-1" } : {}) };
  const submit = vi.fn(async () => ({ submissionId: "saved-1", fleetSaved: false })), save = vi.fn();
  const native = Object.fromEntries(["View", "Text", "ScrollView", "KeyboardAvoidingView"].map(n => [n, n]));
  const deps = { "../coachmarks/DriverGuideTrigger": "GuideTrigger", react, "react-native": { ...native, Platform: { OS: "android" }, StyleSheet: { create: x => x } }, "expo-router": { useFocusEffect: fn => { focused = fn; }, useLocalSearchParams: () => ({ id: current.tripId }), useRouter: () => ({ push() {}, back() {} }) }, "react-native-safe-area-context": { useSafeAreaInsets: () => ({ bottom: 0 }) }, "expo-image-picker": {}, "expo-location": {}, "expo-file-system/legacy": {}, "../clay": { ClayButton: "Button" }, "../../lib/driver-workspace": { resolveDriverWorkspace }, "../ClayScreenHeader": { default: "Header", __esModule: true }, "./CargoWorkflowContent": { CargoWorkflowContent: "Content" }, "./CargoSignatureModal": { CargoSignatureModal: "Signature" }, "./CargoItemReceiptRow": { CargoPhysicalManifest: "Manifest" }, "../../lib/driver-profile": { useDriverProfile: () => ({ profile: { driverType: current.type }, serverConfirmed: true, reload() {} }) }, "../../lib/auth": { useAuth: () => ({ user: { employeeId: current.actor } }) }, "../../lib/connectivity-context": { useConnectivity: () => ({ status: current.online ? "online" : "offline" }) }, "../../lib/theme-context": { useTheme: () => ({ colors: {}, type: {} }) }, "../../lib/api": { api: { get: async () => [trip] } }, "../../lib/cargo-api": { cargoApi: { getExecution: async () => execution } }, "../../lib/cargo-sync": { captureCargoSession: () => current.session, isCurrentCargoSession: value => value === current.session, getCargoSyncState: async () => ({ drafts: pending ? [{ submissionId: "saved-1", syncState: "DEVICE_SAVED", draft: { stage: "PICKUP" } }] : [] }) }, "../../lib/cargo-form-state": { readCargoForm: async () => form, saveCargoForm: save, submitCargoObservation: submit }, "../../lib/cargo-view-model": viewModel, "../../lib/cargo-signature": drawing };
  const scope = { exports: {} }, code = (await transform(readFileSync(new URL("../components/cargo/CargoWorkflowScreen.jsx", import.meta.url), "utf8"), { loader: "jsx", format: "cjs" })).code;
  runInNewContext(code, { React: react, module: scope, exports: scope.exports, setTimeout, clearTimeout, Promise, require: name => { if (!deps[name]) throw Error(`Missing ${name}`); return deps[name]; } });
  let root;
  const render = () => { cursor = rc = ec = 0; root = scope.exports.default({ mode: "pickup" }); queued.splice(0).forEach(fn => fn()); };
  const node = component => { let found; const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (n?.component) { if (n.component === component) found = n; n.children.forEach(walk); } }; walk(root); return found; };
  render(); focused(); await new Promise(resolve => setTimeout(resolve, 0)); render();
  return { render, node, current, execution, trip, submit, save, session };
}
const signed = { version: 1, signer_name: "Alex", signer_role_or_dept: "Stores", acknowledgment: "CARGO_HANDOVER_V1", captured_at: "2026-10-20T02:00:00.000Z", signature: { width: 600, height: 240, strokes: [[[20, 30], [60, 80]]] }, location: null };
describe("real cargo screen signature binding", () => {
  it("opens only after review, cancel keeps counts, and confirmation submits the acknowledged snapshot", async () => {
    const h = await workflow();
    h.node("Content").props.onReview(true); h.render();
    await h.node("Content").props.onSubmit(false); h.render();
    expect(h.submit).not.toHaveBeenCalled(); expect(h.node("Signature").props.visible).toBe(true);
    h.node("Signature").props.onCancel(); h.render();
    expect(h.node("Content").props.form.counts.boxes).toBe("10"); expect(h.submit).not.toHaveBeenCalled();
    await h.node("Content").props.onSubmit(false); h.render();
    await h.node("Signature").props.onConfirm(signed); h.render();
    expect(h.submit).toHaveBeenCalledOnce(); expect(h.submit.mock.calls[0][0]).toMatchObject({ handover: signed, form: { counts: { boxes: "10" } } });
  });
  it.each(["account", "session", "manifest", "assignment", "stage-status", "driver-type", "offline"])("discards unsent signature when %s changes", async change => {
    const h = await workflow(); h.node("Content").props.onReview(true); h.render(); await h.node("Content").props.onSubmit(false); h.render();
    const confirm = h.node("Signature").props.onConfirm;
    if (change === "account") h.current.actor = "13";
    if (change === "session") h.current.session = { actorId: "12", generation: 2 };
    if (change === "manifest") h.execution.manifest.manifest_ref.hash = "b".repeat(64);
    if (change === "assignment") h.trip.vehicle_id = 8;
    if (change === "stage-status") h.trip.trip_status = "Passenger Onboard";
    if (change === "driver-type") h.current.type = "Passenger";
    if (change === "offline") h.current.online = false;
    h.render(); expect(h.node("Signature")?.props.visible).toBeFalsy();
    await confirm(signed); expect(h.submit).not.toHaveBeenCalled();
  });
  it("retries the locked saved receipt without asking for another signature", async () => {
    const h = await workflow({ pending: true }); h.node("Content").props.onReview(true); h.render(); await h.node("Content").props.onSubmit(false); h.render();
    expect(h.submit).toHaveBeenCalledOnce(); expect(h.node("Signature")?.props.visible).toBeFalsy();
  });
});
