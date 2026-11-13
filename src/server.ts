#!/usr/bin/env bun
// Ingest server for Bun: POST /events with a JSON array of events.
// Writes to SQLite with bun:sqlite. Run: bun run src/server.ts, or bunx trackin.
// This is the self-hosted option. src/worker.ts is the Cloudflare Worker option.
import { Database } from "bun:sqlite";
import { handleIngest, INSERT_SQL, MAX_BODY_BYTES, rowValues, type Row } from "./ingest.ts";

export function openDatabase(path = "trackin.sqlite"): Database {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  // Keep in step with migrations/0000_create_events_table.sql (Cloudflare D1).
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

export function createHandler(db: Database) {
  const insert = db.prepare(INSERT_SQL);
  const insertMany = db.transaction((rows: Row[], received: number) => {
    for (const r of rows) insert.run(...rowValues(r, received));
  });

  return (req: Request): Promise<Response> =>
    handleIngest(req, (rows, received) => {
      insertMany(rows, received);
    });
}

export function startServer(options: { port?: number; hostname?: string; db?: Database | string } = {}) {
  const db = typeof options.db === "object" ? options.db : openDatabase(options.db);
  const server = Bun.serve({
    port: options.port ?? 3000,
    hostname: options.hostname,
    maxRequestBodySize: MAX_BODY_BYTES,
    fetch: createHandler(db),
  });
  return { server, db };
}

if (import.meta.main) {
  const { server } = startServer({
    port: Number(process.env.PORT ?? 3000),
    hostname: process.env.HOST,
    db: process.env.DB_PATH ?? "trackin.sqlite",
  });
  console.log(`trackin: listening on ${server.url}events`);
}
