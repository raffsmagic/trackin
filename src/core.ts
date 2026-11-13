// trackin core: make the event, check the gate, run beforeSend,
// put the event in a queue and send batches through a transport.
// Plain TypeScript, no dependencies, no platform APIs except fetch/timers.

export type Props = Record<string, string | number | boolean | null>;

export type Source = "browser" | "node" | "bun" | "react-native";

export interface TrackEvent {
  id: string; // client-side id, the server ignores duplicates
  ts: number; // ms since epoch, set by the client
  name: string;
  session_id: string;
  source: Source;
  props?: Props;
}

/** Sends one batch. Throw or reject to keep the events for the next flush. */
export type Transport = (events: TrackEvent[]) => Promise<void>;

/** Change the event, or return null / false to drop it. */
export type BeforeSend = (event: TrackEvent) => TrackEvent | null | false;

export interface TrackerOptions {
  /** URL of POST /events. Not needed when you give a transport. */
  endpoint?: string;
  /** Replaces the default fetch transport. */
  transport?: Transport;
  beforeSend?: BeforeSend;
  source?: Source;
  /** Send when the queue has this many events. Default 20. Maximum 100. */
  batchSize?: number;
  /** Send at this interval in ms. 0 turns the timer off. Default 5000. */
  flushInterval?: number;
  /** Drop the oldest events when the queue is larger. Default 1000. */
  maxQueue?: number;
  /** Opt-out: when true, track() does nothing. */
  disabled?: boolean;
  onError?: (error: unknown) => void;
}

export interface Tracker {
  track(name: string, props?: Props): void;
  flush(): Promise<void>;
  /** Stop the timer and send what is left. */
  shutdown(): Promise<void>;
  readonly sessionId: string;
}

const MAX_BATCH_SIZE = 100;
/** The server takes bodies up to 64 KB (MAX_BODY_BYTES in ingest.ts), as do sendBeacon and keepalive. */
const MAX_BATCH_BYTES = 60 * 1024;

const byteLength = (s: string): number =>
  typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length * 3;

/** Thrown by the built-in transports when the server answers with an error status. */
export class SendError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * A 4xx answer (other than 408 and 429) will fail again, so the batch is dropped.
 * Any other error, or an error with no `status`, keeps the batch for the next flush.
 */
function isRetryable(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return true;
  return status < 400 || status >= 500 || status === 408 || status === 429;
}

export function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // React Native and old browsers: no randomUUID.
  let s = "";
  for (let i = 0; i < 32; i++) s += ((Math.random() * 16) | 0).toString(16);
  const variant = "89ab"[(Math.random() * 4) | 0];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${variant}${s.slice(17, 20)}-${s.slice(20)}`;
}

export function fetchTransport(endpoint: string, init?: RequestInit): Transport {
  return async (events) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(events),
      ...init,
    });
    if (!res.ok) throw new SendError(`trackin: POST ${endpoint} failed with ${res.status}`, res.status);
  };
}

export function createTracker(options: TrackerOptions): Tracker {
  const {
    beforeSend,
    source = "browser",
    flushInterval = 5000,
    maxQueue = 1000,
    disabled = false,
    onError = () => {},
  } = options;
  // The server rejects batches of more than 100 events (MAX_EVENTS in ingest.ts).
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 20, MAX_BATCH_SIZE));
  const transport =
    options.transport ??
    (options.endpoint ? fetchTransport(options.endpoint) : undefined);
  if (!transport) throw new Error("trackin: give an endpoint or a transport");

  const sessionId = randomId();
  let queue: TrackEvent[] = [];
  let sending: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  if (flushInterval > 0) {
    timer = setInterval(() => void flush(), flushInterval);
    // Do not keep a Node/Bun process alive only for the timer.
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  function track(name: string, props?: Props): void {
    if (disabled || !name) return;
    let event: TrackEvent | null | false = {
      id: randomId(),
      ts: Date.now(),
      name,
      session_id: sessionId,
      source,
      ...(props ? { props } : {}),
    };
    if (beforeSend) {
      try {
        event = beforeSend(event);
      } catch (error) {
        onError(error);
        return;
      }
      if (!event) return;
    }
    queue.push(event);
    if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
    if (queue.length >= batchSize) void flush();
  }

  /** Takes up to batchSize events from the queue, and no more than MAX_BATCH_BYTES of JSON. */
  function takeBatch(): TrackEvent[] {
    const batch: TrackEvent[] = [];
    let bytes = 2; // the [ and ] of the array
    while (queue.length > 0 && batch.length < batchSize) {
      const size = byteLength(JSON.stringify(queue[0])) + 1;
      if (bytes + size > MAX_BATCH_BYTES) {
        if (batch.length > 0) break;
        // One event that is too large by itself can never be sent.
        const dropped = queue.shift()!;
        onError(new Error(`trackin: dropped event "${dropped.name}", larger than ${MAX_BATCH_BYTES} bytes`));
        continue;
      }
      batch.push(queue.shift()!);
      bytes += size;
    }
    return batch;
  }

  async function sendAll(): Promise<void> {
    while (queue.length > 0) {
      const batch = takeBatch();
      if (batch.length === 0) continue;
      try {
        await transport!(batch);
      } catch (error) {
        onError(error);
        if (!isRetryable(error)) continue;
        // Put the batch back; the same ids make the retry safe.
        queue = batch.concat(queue).slice(-maxQueue);
        return;
      }
    }
  }

  function flush(): Promise<void> {
    if (!sending) {
      sending = sendAll().finally(() => {
        sending = null;
      });
    }
    return sending;
  }

  async function shutdown(): Promise<void> {
    if (timer) clearInterval(timer);
    timer = undefined;
    await flush();
  }

  return { track, flush, shutdown, sessionId };
}
