import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createTracker } from "../src/core.ts";
import { openDatabase, startServer } from "../src/server.ts";

let db: Database;
let server: ReturnType<typeof startServer>["server"];
let url: string;

beforeEach(() => {
  ({ db, server } = startServer({ port: 0, db: openDatabase(":memory:") }));
  url = `${server.url}events`;
});

afterEach(() => {
  server.stop(true);
  db.close();
});

const event = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  ts: 1700000000000,
  name: "signup",
  session_id: "s1",
  source: "browser",
  props: { plan: "pro" },
  ...over,
});

const post = (body: unknown, init: RequestInit = {}) =>
  fetch(url, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });

describe("POST /events", () => {
  test("writes an array of events to sqlite", async () => {
    const res = await post([event(), event({ name: "login", props: undefined })]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 2, rejected: 0 });
    const rows = db.query("SELECT * FROM events ORDER BY name").all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("login");
    expect(rows[0].props).toBeNull();
    expect(rows[1].props).toBe('{"plan":"pro"}');
    expect(rows[1].ts).toBe(1700000000000);
    expect(typeof rows[1].received).toBe("number");
  });

  test("ignores a duplicate id, so retries are safe", async () => {
    const e = event();
    await post([e]);
    await post([e, e]);
    const { n } = db.query("SELECT count(*) AS n FROM events").get() as { n: number };
    expect(n).toBe(1);
  });

  test("accepts a text/plain body from sendBeacon", async () => {
    const res = await post([event()], { headers: { "content-type": "text/plain" } });
    expect(res.status).toBe(200);
  });

  test("skips events that are not valid", async () => {
    const res = await post([event(), event({ source: "tv" }), { name: "x" }, event({ props: [1] })]);
    expect(await res.json()).toEqual({ accepted: 1, rejected: 3 });
  });

  test("rejects a body that is not an array", async () => {
    expect((await post(event())).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
  });

  test("returns 404 for other paths and 405 for other methods", async () => {
    expect((await fetch(`${server.url}other`, { method: "POST" })).status).toBe(404);
    expect((await fetch(url)).status).toBe(405);
  });

  test("answers the CORS preflight", async () => {
    const res = await fetch(url, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("client and server together", () => {
  test("tracked events arrive in the database", async () => {
    const t = createTracker({ endpoint: url, source: "bun", flushInterval: 0 });
    t.track("page", { path: "/" });
    t.track("click", { id: 3 });
    await t.flush();
    const rows = db.query("SELECT name, source, session_id FROM events ORDER BY ts, name").all() as any[];
    expect(rows.map((r) => r.name).sort()).toEqual(["click", "page"]);
    expect(rows.every((r) => r.source === "bun" && r.session_id === t.sessionId)).toBe(true);
  });
});
