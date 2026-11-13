import { describe, expect, test } from "bun:test";
import { createTracker, randomId, type TrackEvent, type Transport } from "../src/core.ts";

function recorder() {
  const batches: TrackEvent[][] = [];
  const transport: Transport = async (events) => {
    batches.push(events);
  };
  return { batches, transport };
}

describe("createTracker", () => {
  test("track makes an event with a client-side id, ts, session and props", async () => {
    const { batches, transport } = recorder();
    const t = createTracker({ transport, source: "node", flushInterval: 0 });
    t.track("signup", { plan: "pro" });
    await t.flush();
    expect(batches).toHaveLength(1);
    const [e] = batches[0];
    expect(e.name).toBe("signup");
    expect(e.props).toEqual({ plan: "pro" });
    expect(e.source).toBe("node");
    expect(e.session_id).toBe(t.sessionId);
    expect(typeof e.ts).toBe("number");
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("each event has a different id", async () => {
    const { batches, transport } = recorder();
    const t = createTracker({ transport, flushInterval: 0 });
    for (let i = 0; i < 5; i++) t.track("x");
    await t.flush();
    const ids = new Set(batches[0].map((e) => e.id));
    expect(ids.size).toBe(5);
  });

  test("sends a batch when the queue reaches batchSize", async () => {
    const { batches, transport } = recorder();
    const t = createTracker({ transport, batchSize: 3, flushInterval: 0 });
    t.track("a");
    t.track("b");
    expect(batches).toHaveLength(0);
    t.track("c");
    await t.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0].map((e) => e.name)).toEqual(["a", "b", "c"]);
  });

  test("flush splits the queue into batches of batchSize", async () => {
    const { batches, transport } = recorder();
    const t = createTracker({ transport, batchSize: 2, flushInterval: 0 });
    for (let i = 0; i < 5; i++) t.track(`e${i}`);
    await t.flush();
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  test("sends on the timer", async () => {
    const { batches, transport } = recorder();
    const t = createTracker({ transport, flushInterval: 20 });
    t.track("tick");
    await Bun.sleep(60);
    expect(batches.flat().map((e) => e.name)).toEqual(["tick"]);
    await t.shutdown();
  });

  test("beforeSend can change an event", async () => {
    const { batches, transport } = recorder();
    const t = createTracker({
      transport,
      flushInterval: 0,
      beforeSend: (e) => ({ ...e, props: { ...e.props, app: "web" } }),
    });
    t.track("open", { a: 1 });
    await t.flush();
    expect(batches[0][0].props).toEqual({ a: 1, app: "web" });
  });

  test("beforeSend can drop an event", async () => {
    const { batches, transport } = recorder();
    const t = createTracker({
      transport,
      flushInterval: 0,
      beforeSend: (e) => (e.name === "secret" ? null : e),
    });
    t.track("secret");
    t.track("public");
    await t.flush();
    expect(batches.flat().map((e) => e.name)).toEqual(["public"]);
  });

  test("an error in beforeSend drops the event and calls onError", async () => {
    const { batches, transport } = recorder();
    const errors: unknown[] = [];
    const t = createTracker({
      transport,
      flushInterval: 0,
      onError: (e) => errors.push(e),
      beforeSend: () => {
        throw new Error("boom");
      },
    });
    t.track("x");
    await t.flush();
    expect(batches).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  test("a failed send keeps the batch with the same ids for the next flush", async () => {
    const sent: TrackEvent[][] = [];
    let fail = true;
    const errors: unknown[] = [];
    const t = createTracker({
      flushInterval: 0,
      onError: (e) => errors.push(e),
      transport: async (events) => {
        if (fail) throw new Error("offline");
        sent.push(events);
      },
    });
    t.track("a");
    await t.flush();
    expect(errors).toHaveLength(1);
    expect(sent).toHaveLength(0);
    fail = false;
    t.track("b");
    await t.flush();
    expect(sent.flat().map((e) => e.name)).toEqual(["a", "b"]);
  });

  test("maxQueue drops the oldest events", async () => {
    const { batches, transport } = recorder();
    const t = createTracker({ transport, maxQueue: 2, batchSize: 100, flushInterval: 0 });
    t.track("1");
    t.track("2");
    t.track("3");
    await t.flush();
    expect(batches.flat().map((e) => e.name)).toEqual(["2", "3"]);
  });

  test("disabled does not send", async () => {
    const { batches, transport } = recorder();
    const t = createTracker({ transport, disabled: true, flushInterval: 0 });
    t.track("x");
    await t.flush();
    expect(batches).toHaveLength(0);
  });

  test("needs an endpoint or a transport", () => {
    expect(() => createTracker({})).toThrow();
  });

  test("the default transport POSTs a JSON array to the endpoint", async () => {
    let received: unknown;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        received = await req.json();
        return new Response("ok");
      },
    });
    try {
      const t = createTracker({ endpoint: `${server.url}events`, flushInterval: 0 });
      t.track("hello");
      await t.flush();
      expect(Array.isArray(received)).toBe(true);
      expect((received as TrackEvent[])[0].name).toBe("hello");
    } finally {
      server.stop(true);
    }
  });
});

describe("randomId", () => {
  test("works without crypto.randomUUID", () => {
    const original = globalThis.crypto.randomUUID;
    // @ts-expect-error remove it to act like React Native
    globalThis.crypto.randomUUID = undefined;
    try {
      expect(randomId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    } finally {
      globalThis.crypto.randomUUID = original;
    }
  });
});
