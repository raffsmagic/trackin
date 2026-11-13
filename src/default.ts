// One shared tracker for the simple API: init(), track(), flush().
import { createTracker, type Props, type Tracker, type TrackerOptions } from "./core.ts";

let current: Tracker | undefined;

export function initDefault(options: TrackerOptions): Tracker {
  void current?.shutdown();
  current = createTracker(options);
  return current;
}

/** Does nothing until init() is called. */
export function track(name: string, props?: Props): void {
  current?.track(name, props);
}

export function flush(): Promise<void> {
  return current ? current.flush() : Promise.resolve();
}

export function shutdown(): Promise<void> {
  return current ? current.shutdown() : Promise.resolve();
}
