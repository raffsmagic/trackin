// Ingest server for Cloudflare Workers: POST /events with a JSON array of events.
// Writes to Cloudflare D1. The config is wrangler.jsonc, the table is in migrations/.
// It uses the same validation as the Bun server (src/server.ts) from src/ingest.ts.
import { handleIngest, INSERT_SQL, rowValues } from "./ingest.ts";

// The small part of the D1 API that this Worker uses. It is written here so the
// typecheck does not need the Workers types next to the Bun types.
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface Env {
  /** The D1 binding from wrangler.jsonc. */
  DB: D1Database;
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleIngest(req, async (rows, received) => {
      const insert = env.DB.prepare(INSERT_SQL);
      // A batch runs as one transaction, like the Bun server's insertMany.
      await env.DB.batch(rows.map((r) => insert.bind(...rowValues(r, received))));
    });
  },
};
