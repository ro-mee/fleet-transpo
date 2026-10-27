const empty = () => ({ id: "", url: "", loadingId: "", error: "" });

// Private links belong only to this mounted trip/session, never a shared cache.
export function createCargoPhotoSession({ load, onChange }) {
  let request;
  let expiry;
  let disposed = false;
  function cancel() {
    request?.abort();
    request = null;
    clearTimeout(expiry);
  }
  return {
    async open(id) {
      if (disposed) return;
      cancel();
      const controller = new AbortController();
      request = controller;
      onChange({ ...empty(), id, loadingId: id });
      try {
        const result = await load(id, { signal: controller.signal });
        if (controller.signal.aborted || disposed) return;
        if (!result?.url || result.expires_in !== 300) throw new Error("The private cargo photo is unavailable.");
        onChange({ ...empty(), id, url: result.url });
        expiry = setTimeout(() => onChange({ ...empty(), error: "Photo access expired. Open the photo again to renew access." }), result.expires_in * 1000);
      } catch (error) {
        if (!controller.signal.aborted && !disposed) onChange({ ...empty(), id, error: error.message || "The private photo could not be opened." });
      }
    },
    hide() { cancel(); if (!disposed) onChange(empty()); },
    imageFailed() { cancel(); if (!disposed) onChange({ ...empty(), error: "The saved photo could not be displayed. Open the photo again to retry." }); },
    dispose() { disposed = true; cancel(); },
  };
}
