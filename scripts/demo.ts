// End-to-end demo: start the server, send events with the node entry,
// then print the rows in SQLite. Run: bun run scripts/demo.ts
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { startServer } from "../src/server.ts";
import { init, track, shutdown } from "../src/node.ts";

const path = "demo.sqlite";
for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });

const { server, db } = startServer({ port: 0, db: path });
const endpoint = `http://localhost:${server.port}/events`;
console.log(`server: ${endpoint}`);

init({ endpoint });
track("app_started", { version: "0.1.0" });
track("page_view", { path: "/home" });
track("button_click", { id: "signup" });
track("purchase", { amount: 9.99, currency: "USD" });
track("app_stopped");
await shutdown();

const rows = new Database(path, { readonly: true })
  .query("SELECT id, ts, received, name, session_id, source, props FROM events ORDER BY ts")
  .all();
console.table(rows);

server.stop(true);
db.close();
