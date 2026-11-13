// Send three events with the node entry to an endpoint.
// Run: bun run scripts/send.ts <endpoint>
import { init, track, shutdown } from "../src/node.ts";

const endpoint = process.argv[2];
if (!endpoint) {
  console.error("Usage: bun run scripts/send.ts <endpoint>");
  process.exit(1);
}

const failures: unknown[] = [];
init({ endpoint, onError: (error) => failures.push(error) });
track("app_started", { version: "0.1.0" });
track("page_view", { path: "/home" });
track("button_click", { id: "signup" });
await shutdown();
if (failures.length > 0) {
  for (const error of failures) console.error("send failed:", error);
  process.exit(1);
}
console.log(`sent 3 events to ${endpoint}`);
