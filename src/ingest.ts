// Shared ingest logic for POST /events. The Bun server (src/server.ts) and the
// Cloudflare Worker (src/worker.ts) both use it. It uses only web APIs, so it
// must not import anything from "bun:".

export const SOURCES = new Set(["browser", "node", "bun", "react-native"]);
export const MAX_EVENTS = 100;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_PROPS_BYTES = 2048;
export const MAX_SESSION_ID_LENGTH = 64;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_FUTURE_MS = DAY_MS;
export const MAX_AGE_MS = 30 * DAY_MS;

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

/** Keep in step with openDatabase() in src/server.ts and migrations/. */
export const INSERT_SQL = `INSERT OR IGNORE INTO events (id, ts, received, name, session_id, source, props)
     VALUES (?, ?, ?, ?, ?, ?, ?)`;

export type Row = {
  id: string;
  ts: number;
  name: string;
  session_id: string | null;
  source: string;
  props: string | null;
};

/** The values for INSERT_SQL, in order. */
export function rowValues(r: Row, received: number) {
  return [r.id, r.ts, received, r.name, r.session_id, r.source, r.props] as const;
}

export function toRow(e: unknown, now: number = Date.now()): Row | null {
  if (!e || typeof e !== "object") return null;
  const v = e as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id || v.id.length > 64) return null;
  if (typeof v.ts !== "number" || !Number.isFinite(v.ts)) return null;
  if (typeof v.name !== "string" || !v.name || v.name.length > 200) return null;
  if (typeof v.source !== "string" || !SOURCES.has(v.source)) return null;
  if (v.ts > now + MAX_FUTURE_MS || v.ts < now - MAX_AGE_MS) return null;
  if (v.session_id != null && typeof v.session_id !== "string") return null;
  if (typeof v.session_id === "string" && v.session_id.length > MAX_SESSION_ID_LENGTH) return null;
  if (v.props != null && (typeof v.props !== "object" || Array.isArray(v.props))) return null;
  const props = v.props == null ? null : JSON.stringify(v.props);
  if (props !== null && new TextEncoder().encode(props).length > MAX_PROPS_BYTES) return null;
  return {
    id: v.id,
    ts: Math.trunc(v.ts),
    name: v.name,
    session_id: (v.session_id as string | undefined) ?? null,
    source: v.source,
    props,
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

/**
 * Handles one request to the ingest server. `write` stores the valid rows;
 * each server gives its own database code.
 */
export async function handleIngest(
  req: Request,
  write: (rows: Row[], received: number) => void | Promise<void>,
): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== "/events") return json({ error: "not found" }, 404);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const tooLarge = () => json({ error: `body is larger than ${MAX_BODY_BYTES} bytes` }, 413);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();

  // Read as text: sendBeacon sends text/plain.
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return tooLarge();

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "body is not JSON" }, 400);
  }
  if (!Array.isArray(body)) return json({ error: "body must be an array of events" }, 400);
  if (body.length > MAX_EVENTS) return json({ error: `more than ${MAX_EVENTS} events` }, 413);

  const now = Date.now();
  const rows = body.map((e) => toRow(e, now)).filter((r): r is Row => r !== null);
  if (rows.length > 0) await write(rows, now);
  return json({ accepted: rows.length, rejected: body.length - rows.length });
}
