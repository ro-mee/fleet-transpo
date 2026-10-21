import React from "react";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const start = { reading_km: 25000, recorded_at: "2026-10-17T00:05:00Z", photo_url: "https://private.example/start?token=one", photo_state: "available" };
const end = { ...start, reading_km: 25045, photo_url: "https://private.example/end?token=one" };
const completed = { trip_id: 7, trip_status: "Completed", start_odometer: 25000, end_odometer: 25045, distance: 45, distance_provenance: "odometer", vehicles: { plate_number: "ABC 123" } };

async function harness({ trip = completed, data = { start, end, distance_km: 45, distance_source: "odometer" }, error = null, loading = false } = {}) {
  const { code } = await transform(readFileSync(new URL("./trip-odometer-evidence.jsx", import.meta.url), "utf8"), { loader: "jsx", format: "cjs" });
  const slots = new Map();
  const mountedButtons = new Map();
  const activeButtons = new Set();
  let focusedElement = null;
  const queries = [];
  let slot, index;
  let actor = 12;
  let props = { trip };
  let query = { data, isError: !!error, error, isLoading: loading, isFetching: loading, refetch: vi.fn().mockResolvedValue({ isSuccess: true, data }) };
  const apiFetch = vi.fn().mockResolvedValue(data);
  const stubReact = { ...React,
    useState: initial => { const current = slot; const at = index++; if (!(at in current)) current[at] = typeof initial === "function" ? initial() : initial; return [current[at], next => { current[at] = typeof next === "function" ? next(current[at]) : next; }]; },
    useRef: initial => { const at = index++; if (!(at in slot)) slot[at] = { current: initial }; return slot[at]; },
    useId: () => "evidence-description",
    createElement: (type, attributes, ...children) => ({ type, props: { ...attributes, children } }),
  };
  const deps = {
    react: stubReact,
    "@tanstack/react-query": { useQuery: options => { queries.push(options); return query; } },
    "@/hooks/use-auth": { useAuth: () => ({ employee: actor ? { employee_id: actor } : null, user: actor ? { employeeId: actor } : null }) },
    "@/lib/api/client": { apiFetch },
    "@/lib/utils": { formatDateTime: value => `Formatted ${value}`, cn: (...values) => values.join(" ") },
    "@/components/ui/card": { Card: "Card", CardContent: "CardContent" },
    "@/components/ui/button": { Button: "Button" },
    "@/components/ui/dialog": { Dialog: "Dialog", DialogContent: "DialogContent", DialogHeader: "DialogHeader", DialogTitle: "DialogTitle", DialogDescription: "DialogDescription", DialogFooter: "DialogFooter" },
    "lucide-react": { Camera: "Camera", RefreshCw: "RefreshCw", X: "X" },
  };
  const scope = { exports: {} };
  runInNewContext(code, { React: stubReact, module: scope, exports: scope.exports, require: name => { if (!deps[name]) throw Error(name); return deps[name]; } });
  function expand(node, path = "root") {
    if (Array.isArray(node)) return node.map((child, i) => expand(child, `${path}.${i}`));
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const location = `${path}:${node.props.key ?? ""}:${node.type.name}`;
      if (!slots.has(location)) slots.set(location, []);
      slot = slots.get(location); index = 0;
      return expand(node.type(node.props), location);
    }
    let element;
    if (node.type === "Button") {
      const location = `${path}:${node.props.key ?? ""}`;
      if (!mountedButtons.has(location)) {
        const button = { isConnected: true, focus: vi.fn(() => { if (button.isConnected) focusedElement = button; }) };
        mountedButtons.set(location, button);
      }
      element = mountedButtons.get(location);
      element.isConnected = true;
      activeButtons.add(element);
    }
    return { ...node, element, props: { ...node.props, children: expand(node.props.children, `${path}.children`) } };
  }
  const nodes = [];
  function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== "object") return; nodes.push(node); visit(node.props.children); }
  const h = { queries, apiFetch, render() { nodes.length = 0; activeButtons.clear(); visit(expand(stubReact.createElement(scope.exports.TripOdometerEvidence, props))); for (const button of mountedButtons.values()) if (!activeButtons.has(button)) button.isConnected = false; return h; }, nodes,
    text() { const text = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (typeof node === "string" || typeof node === "number") text.push(node); else if (node?.props) walk(node.props.children); } nodes.filter(n => n.type === "Card").forEach(walk); return text.join(" "); },
    setQuery(next) { query = { ...query, ...next }; return h.render(); }, setTrip(next) { props = { trip: next }; return h.render(); }, setActor(next) { actor = next; return h.render(); },
    find: predicate => nodes.find(predicate), refetch: query.refetch,
    focusedElement: () => focusedElement,
  };
  return h.render();
}

describe("Trip odometer evidence", () => {
  it("pairs both saved readings with contained photos in a single responsive card", async () => {
    const h = await harness();
    expect(h.text()).toContain("25,000"); expect(h.text()).toContain("25,045"); expect(h.text()).toContain("45");
    expect(h.text()).toContain("From odometer readings");
    expect(h.nodes.filter(n => n.type === "Card")).toHaveLength(1);
    expect(h.nodes.filter(n => n.type === "img")).toHaveLength(2);
    expect(h.nodes.filter(n => n.type === "img").every(n => n.props.className.includes("object-contain"))).toBe(true);
    expect(h.find(n => n.props.className?.includes("md:grid-cols-2"))).toBeTruthy();
    expect(h.find(n => n.props.className?.includes("aspect-[16/10]"))).toBeTruthy();
  });
  it("leaves an active ending unknown without fabricating zero or current vehicle mileage", async () => {
    const h = await harness({ trip: { ...completed, trip_status: "En Route", end_odometer: null, current_mileage: 99999, distance: null }, data: { start, end: null, distance_km: null, distance_source: null } });
    expect(h.text()).toContain("Not recorded yet"); expect(h.text()).not.toContain("99,999"); expect(h.text()).not.toContain("0 km");
    expect(h.nodes.some(n => n.props["aria-label"] === "View ending odometer photo for ABC 123")).toBe(false);
  });
  it("shows legacy saved numbers and explicitly absent photos", async () => {
    const h = await harness({ data: { start: { ...start, photo_url: null, photo_state: "not_recorded" }, end: { ...end, photo_url: null, photo_state: "not_recorded" }, distance_km: 45, distance_source: "trip-distance" } });
    expect(h.text()).toContain("No photo recorded"); expect(h.text()).toContain("25,045"); expect(h.text()).toContain("Saved trip distance");
    expect(h.nodes.some(n => n.props["aria-label"]?.startsWith("View "))).toBe(false);
  });
  it.each(["gps-trail", null])("labels the actual saved distance source %s", async source => {
    const h = await harness({ data: { start: null, end: null, distance_km: 45, distance_source: source }, trip: { ...completed, distance_provenance: source } });
    expect(h.text()).toContain(source === "gps-trail" ? "GPS distance" : "Source not recorded");
  });
  it("keeps saved numbers while loading or after endpoint failure and retries only that query", async () => {
    const h = await harness({ data: null, loading: true });
    expect(h.text()).toContain("25,000"); expect(h.text()).toContain("25,045");
    expect(h.text()).toContain("Loading photo..."); expect(h.nodes.some(n => n.type === "img")).toBe(false);
    h.setQuery({ isLoading: false, isFetching: false, isError: true, error: new Error("Offline") });
    expect(h.text()).toContain("25,045"); expect(h.text()).toContain("could not be loaded");
    await h.find(n => n.type === "Button" && n.props.children.includes("Retry")).props.onClick();
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });
  it("retains saved readings when signing or an image fails, and refreshes access on Retry", async () => {
    const h = await harness({ data: { start: { ...start, photo_url: null, photo_state: "unavailable" }, end, distance_km: 45, distance_source: "odometer" } });
    expect(h.text()).toContain("Photo unavailable"); expect(h.text()).toContain("25,000");
    h.find(n => n.type === "img").props.onError(); h.render();
    expect(h.text()).toContain("25,045");
    await h.find(n => n.type === "Button" && n.props.children.includes("Retry")).props.onClick();
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });
  it("opens a described Radix preview, closes through its shared contract, and restores the invoking control", async () => {
    const h = await harness();
    const focus = vi.fn();
    const opener = h.find(n => n.type === "Button" && n.props["aria-label"] === "View starting odometer photo for ABC 123");
    opener.props.onClick({ currentTarget: { focus } }); h.render();
    expect(h.find(n => n.type === "Dialog").props.open).toBe(true);
    expect(h.nodes.some(n => n.type === "DialogTitle" && n.props.children.join("").includes("Starting odometer"))).toBe(true);
    expect(h.find(n => n.type === "DialogContent").props["aria-describedby"]).toBeTruthy();
    expect(h.find(n => n.type === "DialogDescription")).toBeTruthy();
    h.find(n => n.type === "Dialog").props.onOpenChange(false); h.render();
    const event = { preventDefault: vi.fn() };
    h.find(n => n.type === "DialogContent").props.onCloseAutoFocus(event);
    expect(focus).toHaveBeenCalledTimes(1); expect(event.preventDefault).toHaveBeenCalled();
  });
  it.each([true, false])("returns focus to the same live opener after signing refresh removes the photo URL (thumbnail=%s)", async thumbnail => {
    const h = await harness();
    const isOpener = n => n.type === "Button" && n.props["aria-label"] === "View starting odometer photo for ABC 123" && !!n.props.className?.includes("aspect-[16/10]") === thumbnail;
    const original = h.find(isOpener).element;
    h.find(isOpener).props.onClick({ currentTarget: original }); h.render();
    h.setQuery({ data: { start: { ...start, photo_url: null, photo_state: "unavailable" }, end, distance_km: 45, distance_source: "odometer" } });
    expect(h.find(n => n.type === "Dialog").props.open).toBe(true);
    expect(h.text()).toContain("Photo unavailable"); expect(h.text()).toContain("25,000");
    expect(original.isConnected).toBe(true);
    expect(h.find(isOpener).element).toBe(original);
    h.find(n => n.type === "Dialog").props.onOpenChange(false); h.render();
    h.find(n => n.type === "DialogContent").props.onCloseAutoFocus({ preventDefault: vi.fn() });
    expect(h.focusedElement()).toBe(original);
    expect(original.focus).toHaveBeenCalledTimes(1);
  });
  it("bounds detail fetching, scopes it by actor and trip, forwards cancellation, and resets preview on identity changes", async () => {
    const h = await harness();
    const options = h.queries.at(-1);
    expect(options.queryKey).toEqual(["trip-odometer-evidence", 12, 7]);
    expect(options.gcTime).toBe(0); expect(options.retry).toBe(false); expect(options.refetchInterval).toBe(false); expect(options.meta.persist).toBe(false);
    const signal = new AbortController().signal;
    await options.queryFn({ signal });
    expect(h.apiFetch).toHaveBeenCalledWith("/api/trips/7/odometer", { signal });
    h.find(n => n.type === "Button" && n.props["aria-label"]?.startsWith("View starting")).props.onClick({ currentTarget: { focus: vi.fn() } }); h.render();
    h.setActor(13);
    expect(h.find(n => n.type === "Dialog").props.open).toBe(false);
    expect(h.queries.at(-1).queryKey).toEqual(["trip-odometer-evidence", 13, 7]);
    h.setTrip({ ...completed, trip_id: 8 });
    expect(h.find(n => n.type === "Dialog").props.open).toBe(false);
    expect(h.queries.at(-1).queryKey).toEqual(["trip-odometer-evidence", 13, 8]);
    h.setActor(null); expect(h.queries.at(-1).enabled).toBe(false);
  });
});
