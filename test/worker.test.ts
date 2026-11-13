import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { openDatabase } from "../src/server.ts";
import worker, { type D1Database, type D1PreparedStatement, type Env } from "../src/worker.ts";

const MIGRATION = new URL("../migrations/0000_create_events_table.sql", import.meta.url);

// Runs the D1 migration on a bun:sqlite database, one statement at a time.
async function migratedDatabase(): Promise<Database> {
  const db = new Database(":memory:");
  const sql = await Bun.file(MIGRATION).text();
  for (const statement of sql.split(";")) {
    if (statement.replace(/--.*$/gm, "").trim()) db.run(statement);
  }
  return db;
}

// A fake D1 binding on top of bun:sqlite, with only what the Worker uses.
type FakeStatement = D1PreparedStatement & { run(): void };
function fakeD1(db: Database): D1Database {
  return {
    prepare(query) {
      const make = (values: unknown[]): FakeStatement => ({
        bind: (...v) => make(v),
        run: () => void db.prepare(query).run(...(values as any[])),
      });
      return make([]);
    },
    async batch(statements) {
      db.transaction(() => {
        for (const s of statements) (s as FakeStatement).run();
      })();
      return [];
    },
  };
}

let db: Database;
let env: Env;

beforeEach(async () => {
  db = await migratedDatabase();
  env = { DB: fakeD1(db) };
});

afterEach(() => db.close());

const event = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  ts: Date.now(),
  name: "signup",
  session_id: "s1",
  source: "browser",
  props: { plan: "pro" },
  ...over,
});

const call = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`https://worker.example${path}`, init), env);

const post = (body: unknown) =>
  call("/events", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("D1 migration", () => {
  test("creates the same table and index as the Bun server", async () => {
    const bun = openDatabase(":memory:");
    const schema = (d: Database) => ({
      columns: d.query("PRAGMA table_info(events)").all(),
      indexes: d.query("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all(),
    });
    expect(schema(db).columns).toEqual(schema(bun).columns);
    expect((schema(db).indexes as any[]).map((i) => i.name)).toEqual(
      (schema(bun).indexes as any[]).map((i) => i.name),
    );
    bun.close();
  });
});

describe("Worker POST /events", () => {
  test("writes an array of events to D1", async () => {
    const res = await post([event(), event({ name: "login", props: undefined })]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 2, rejected: 0 });
    const rows = db.query("SELECT * FROM events ORDER BY name").all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].props).toBeNull();
    expect(rows[1].props).toBe('{"plan":"pro"}');
    expect(typeof rows[1].received).toBe("number");
  });

  test("ignores a duplicate id, so retries are safe", async () => {
    const e = event();
    await post([e]);
    await post([e, e]);
    const { n } = db.query("SELECT count(*) AS n FROM events").get() as { n: number };
    expect(n).toBe(1);
  });

  test("skips events that are not valid", async () => {
    const res = await post([event(), event({ source: "tv" }), { name: "x" }, event({ props: [1] })]);
    expect(await res.json()).toEqual({ accepted: 1, rejected: 3 });
  });

  test("rejects a body that is not an array or is too large", async () => {
    expect((await post(event())).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post("x".repeat(64 * 1024 + 1))).status).toBe(413);
  });

  test("rejects more than 100 events", async () => {
    expect((await post(Array.from({ length: 101 }, () => event()))).status).toBe(413);
    expect((await post(Array.from({ length: 100 }, () => event()))).status).toBe(200);
  });

  test("returns 404, 405 and answers the CORS preflight", async () => {
    expect((await call("/other", { method: "POST" })).status).toBe(404);
    expect((await call("/events")).status).toBe(405);
    const res = await call("/events", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
