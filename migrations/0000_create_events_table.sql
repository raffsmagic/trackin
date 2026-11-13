-- Migration number: 0000
-- Creates the events table for the Cloudflare Worker (src/worker.ts) in D1.
-- Keep in step with openDatabase() in src/server.ts.
CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  ts         INTEGER NOT NULL,
  received   INTEGER NOT NULL,
  name       TEXT NOT NULL,
  session_id TEXT,
  source     TEXT NOT NULL,
  props      TEXT
);

CREATE INDEX IF NOT EXISTS events_name_ts ON events (name, ts);
