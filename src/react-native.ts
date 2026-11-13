// React Native entry. Uses fetch and flushes when the app goes to the
// background. Give AppState from "react-native"; trackin does not import it.
import type { Tracker, TrackerOptions } from "./core.ts";
import { initDefault } from "./default.ts";

export * from "./core.ts";
export { track, flush, shutdown } from "./default.ts";

export interface AppStateLike {
  addEventListener(type: "change", listener: (state: string) => void): unknown;
}

export interface ReactNativeOptions extends TrackerOptions {
  appState?: AppStateLike;
}

export function init({ appState, ...options }: ReactNativeOptions): Tracker {
  const tracker = initDefault({ source: "react-native", ...options });
  appState?.addEventListener("change", (state) => {
    if (state === "background" || state === "inactive") void tracker.flush();
  });
  return tracker;
}
