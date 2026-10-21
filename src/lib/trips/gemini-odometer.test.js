import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveAiProvider } from "@/lib/ai/llm-adapter";
import { scanOdometerWithGemini } from "./gemini-odometer";
vi.mock("@/lib/ai/llm-adapter", () => ({ getActiveAiProvider: vi.fn() }));
const bytes = Buffer.from("photo");
const payload = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ reading_text: "25000", unit: "km", display_kind: "total", readable: true }) }] } }] };
beforeEach(() => {
  getActiveAiProvider.mockResolvedValue({ api_key: "secret", model_name: "gemini-2.5-flash" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("Gemini odometer transport", () => {
  it.each(["timeout", "caller abort"])("bounds stalled provider lookup on %s and never sends after late resolution", async (reason) => {
    vi.useFakeTimers();
    let resolveProvider;
    getActiveAiProvider.mockReturnValue(new Promise((resolve) => { resolveProvider = resolve; }));
    const controller = new AbortController();
    let error;
    const pending = scanOdometerWithGemini(bytes, "image/jpeg", { signal: controller.signal }).catch((failure) => { error = failure; });
    if (reason === "timeout") await vi.advanceTimersByTimeAsync(12000);
    else { controller.abort(); await vi.advanceTimersByTimeAsync(0); }
    try {
      expect(error).toMatchObject({ code: "ODOMETER_SCAN_UNAVAILABLE", message: "Odometer reading is unavailable. Please retry." });
      expect(vi.getTimerCount()).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      resolveProvider({ api_key: "secret", model_name: "gemini-2.5-flash" });
      await pending;
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["image/jpeg", "image/png"])("sends %s and returns only normalized fields", async (mimeType) => {
    expect(await scanOdometerWithGemini(bytes, mimeType)).toEqual({ readingText: "25000", readingKm: 25000, unit: "km", displayKind: "total", failureCode: null, modelName: "gemini-2.5-flash", scanVersion: "odometer-v1" });
    const [url, request] = fetch.mock.calls[0];
    expect(url).toContain("gemini-2.5-flash:generateContent");
    expect(JSON.parse(request.body).contents[0].parts[0].inlineData).toEqual({ mimeType, data: bytes.toString("base64") });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getActiveAiProvider).toHaveBeenCalledWith("Gemini");
  });
  it("uses the optional odometer model", async () => {
    vi.stubEnv("GEMINI_ODOMETER_MODEL", "gemini-2.5-pro");
    expect((await scanOdometerWithGemini(bytes, "image/jpeg")).modelName).toBe("gemini-2.5-pro");
  });
  it.each([429, 500, 503, 404])("sanitizes HTTP %s without retries", async (status) => {
    fetch.mockResolvedValue({ ok: false, status, text: async () => "secret provider details" });
    await expect(scanOdometerWithGemini(bytes, "image/jpeg")).rejects.toMatchObject({ code: "ODOMETER_SCAN_UNAVAILABLE", message: "Odometer reading is unavailable. Please retry." });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([null, { api_key: "secret", model_name: "text-only" }])("rejects unavailable configuration", async (provider) => {
    getActiveAiProvider.mockResolvedValue(provider);
    await expect(scanOdometerWithGemini(bytes, "image/jpeg")).rejects.toMatchObject({ code: "ODOMETER_SCAN_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sanitizes thrown transport and configuration errors", async () => {
    getActiveAiProvider.mockRejectedValue(new Error("secret"));
    await expect(scanOdometerWithGemini(bytes, "image/jpeg")).rejects.toMatchObject({ message: "Odometer reading is unavailable. Please retry." });
  });
  it("aborts its single active request after twelve seconds", async () => {
    vi.useFakeTimers();
    fetch.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("secret")))));
    const pending = expect(scanOdometerWithGemini(bytes, "image/jpeg")).rejects.toMatchObject({ code: "ODOMETER_SCAN_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(12000);
    await pending;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("honors caller cancellation before sending", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(scanOdometerWithGemini(bytes, "image/jpeg", { signal: controller.signal })).rejects.toMatchObject({ code: "ODOMETER_SCAN_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("cancels an active request when its caller cancels", async () => {
    const controller = new AbortController();
    fetch.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("secret transport detail")))));
    const pending = expect(scanOdometerWithGemini(bytes, "image/jpeg", { signal: controller.signal })).rejects.toMatchObject({ code: "ODOMETER_SCAN_UNAVAILABLE" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort();
    await pending;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("sanitizes network failures", async () => {
    fetch.mockRejectedValue(new Error("secret image data"));
    await expect(scanOdometerWithGemini(bytes, "image/jpeg")).rejects.toMatchObject({ message: "Odometer reading is unavailable. Please retry." });
  });
  it("rejects unsupported MIME", async () => {
    await expect(scanOdometerWithGemini(bytes, "text/plain")).rejects.toMatchObject({ code: "ODOMETER_SCAN_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
