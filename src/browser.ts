// Browser entry. Uses sendBeacon (or fetch with keepalive) and flushes
// when the page becomes hidden.
import type { Tracker, TrackerOptions, Transport } from "./core.ts";
import { initDefault } from "./default.ts";

export * from "./core.ts";
export { track, flush, shutdown } from "./default.ts";

/** text/plain avoids a CORS preflight, which sendBeacon cannot do. */
export function beaconTransport(endpoint: string): Transport {
  return async (events) => {
    const body = JSON.stringify(events);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "text/plain" });
      if (navigator.sendBeacon(endpoint, blob)) return;
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body,
      keepalive: true,
    });
    if (!res.ok) throw new Error(`tinytrack: POST ${endpoint} failed with ${res.status}`);
  };
}

/** The current listener. init() removes it before it adds a new one. */
let onHidden: (() => void) | undefined;

export function init(options: TrackerOptions): Tracker {
  const tracker = initDefault({
    source: "browser",
    ...options,
    transport:
      options.transport ?? (options.endpoint ? beaconTransport(options.endpoint) : undefined),
  });
  if (typeof document !== "undefined") {
    if (onHidden) document.removeEventListener("visibilitychange", onHidden);
    onHidden = () => {
      if (document.visibilityState === "hidden") void tracker.flush();
    };
    document.addEventListener("visibilitychange", onHidden);
  }
  return tracker;
}
