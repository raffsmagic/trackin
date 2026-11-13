// Node and Bun entry. Uses fetch, batches by count and by time, and
// flushes before the process exits. Call shutdown() before process.exit().
import type { Tracker, TrackerOptions } from "./core.ts";
import { initDefault, shutdown } from "./default.ts";

export * from "./core.ts";
export { track, flush, shutdown } from "./default.ts";

let hooked = false;

export function init(options: TrackerOptions): Tracker {
  const source = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun" : "node";
  const tracker = initDefault({ source, ...options });
  const proc = (globalThis as { process?: { once(e: string, f: () => void): void } }).process;
  if (!hooked && proc) {
    hooked = true;
    // beforeExit fires when the event loop is empty, so async work can still run.
    proc.once("beforeExit", () => void shutdown());
  }
  return tracker;
}
