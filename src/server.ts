// Ingest server for Bun: POST /events with a JSON array of events.
// Writes to SQLite with bun:sqlite. Run: bun run src/server.ts
import { Database } from "bun:sqlite";

const SOURCES = new Set(["browser", "node", "bun", "react-native"]);
const MAX_EVENTS = 1000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function openDatabase(path = "tinytrack.sqlite"): Database {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id         TEXT PRIMARY KEY,
    ts         INTEGER NOT NULL,
    received   INTEGER NOT NULL,
    name       TEXT NOT NULL,
    session_id TEXT,
    source     TEXT NOT NULL,
    props      TEXT
  )`);
  db.run("CREATE INDEX IF NOT EXISTS events_name_ts ON events (name, ts)");
  return db;
}

type Row = {
  id: string;
  ts: number;
  name: string;
  session_id: string | null;
  source: string;
  props: string | null;
};

function toRow(e: unknown): Row | null {
  if (!e || typeof e !== "object") return null;
  const v = e as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id || v.id.length > 64) return null;
  if (typeof v.ts !== "number" || !Number.isFinite(v.ts)) return null;
  if (typeof v.name !== "string" || !v.name || v.name.length > 200) return null;
  if (typeof v.source !== "string" || !SOURCES.has(v.source)) return null;
  if (v.session_id != null && typeof v.session_id !== "string") return null;
  if (v.props != null && (typeof v.props !== "object" || Array.isArray(v.props))) return null;
  return {
    id: v.id,
    ts: Math.trunc(v.ts),
    name: v.name,
    session_id: (v.session_id as string | undefined) ?? null,
    source: v.source,
    props: v.props == null ? null : JSON.stringify(v.props),
  };
}

export function createHandler(db: Database) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO events (id, ts, received, name, session_id, source, props)
     VALUES ($id, $ts, $received, $name, $session_id, $source, $props)`,
  );
  const insertMany = db.transaction((rows: Row[], received: number) => {
    for (const r of rows) {
      insert.run({
        $id: r.id,
        $ts: r.ts,
        $received: received,
        $name: r.name,
        $session_id: r.session_id,
        $source: r.source,
        $props: r.props,
      });
    }
  });

  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: CORS });

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname !== "/events") return json({ error: "not found" }, 404);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

    let body: unknown;
    try {
      // Read as text: sendBeacon sends text/plain.
      body = JSON.parse(await req.text());
    } catch {
      return json({ error: "body is not JSON" }, 400);
    }
    if (!Array.isArray(body)) return json({ error: "body must be an array of events" }, 400);
    if (body.length > MAX_EVENTS) return json({ error: `more than ${MAX_EVENTS} events` }, 413);

    const rows = body.map(toRow).filter((r): r is Row => r !== null);
    insertMany(rows, Date.now());
    return json({ accepted: rows.length, rejected: body.length - rows.length });
  };
}

export function startServer(options: { port?: number; db?: Database | string } = {}) {
  const db = typeof options.db === "object" ? options.db : openDatabase(options.db);
  const server = Bun.serve({
    port: options.port ?? 3000,
    maxRequestBodySize: 1024 * 1024,
    fetch: createHandler(db),
  });
  return { server, db };
}

if (import.meta.main) {
  const { server } = startServer({
    port: Number(process.env.PORT ?? 3000),
    db: process.env.DB_PATH ?? "tinytrack.sqlite",
  });
  console.log(`tinytrack: listening on ${server.url}events`);
}
