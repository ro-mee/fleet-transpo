"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const POSTAL_PATTERN = /^\d{4}$/;
const CHECK_TIMEOUT_MS = 5000;

/** A stale ZIP response is never allowed to describe a different selection. */
export function usePostalCodeCheck({ psgcBarangayCode, postalCode, enabled = true } = {}) {
  const code = psgcBarangayCode ?? null;
  const zip = String(postalCode ?? "").trim();
  const key = `${code ?? ""}|${zip}`;
  const keyRef = useRef(key);
  const controllerRef = useRef(null);
  const [answer, setAnswer] = useState({ key: null, status: "idle", postalCodes: [] });
  useLayoutEffect(() => {
    keyRef.current = key;
  }, [key]);

  useEffect(() => {
    if (!enabled || !code || !POSTAL_PATTERN.test(zip)) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      return undefined;
    }

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    let debounce;

    async function run() {
      try {
        const response = await fetch("/api/address/postal-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ psgcBarangayCode: code, postalCode: zip }),
          signal: controller.signal,
        });
        const data = response.ok ? await response.json() : null;
        if (controllerRef.current !== controller || keyRef.current !== key) return;
        const status = ["match", "mismatch", "unknown"].includes(data?.status)
          ? data.status
          : "unavailable";
        setAnswer({
          key,
          status,
          postalCodes: Array.isArray(data?.postalCodes) ? data.postalCodes : [],
        });
      } catch {
        if (controllerRef.current !== controller || keyRef.current !== key) return;
        setAnswer({ key, status: "unavailable", postalCodes: [] });
      } finally {
        clearTimeout(timeout);
      }
    }

    debounce = setTimeout(run, 250);
    return () => {
      clearTimeout(debounce);
      clearTimeout(timeout);
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [code, zip, key, enabled]);

  if (!enabled || !code || !POSTAL_PATTERN.test(zip)) {
    return { status: "idle", postalCodes: [] };
  }
  if (answer.key !== key) return { status: "checking", postalCodes: [] };
  return answer;
}
