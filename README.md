# trackin

A tiny event tracking library in TypeScript, for the browser, Node and Bun servers, and React Native. It has no dependencies, and the browser bundle is about 1.4 KB gzip.

You call `track("signup_clicked", { plan: "pro" })`. trackin gives the event a client-side id, puts it in a queue and sends batches to `POST /events` on your server. You run that server yourself: a Bun server that writes to SQLite, or a Cloudflare Worker that writes to D1.

## What trackin does not do

- No cookies, no `localStorage` and no fingerprinting. The session id is random and lives in memory only, so it changes on each page load or process start.
- No user identity: no `identify`, `alias` or merging of users.
- No autocapture. Nothing is sent unless you call `track()`.
- No session replay, heatmaps, feature flags or experiments.
- No IP address, user agent or GeoIP is stored. The server stores only the fields in the event.
- No offline storage. Events that are not sent when the page or process stops are lost.
- No dashboard. Query the `events` table with SQL.

## Install

```sh
npm install trackin
```

trackin is an ES module package. It needs `fetch`, which browsers, Node 18+, Bun and React Native have.

## Browser

```ts
import { init, track } from "trackin/browser";

init({ endpoint: "https://example.com/events" });
track("signup_clicked", { plan: "pro" });
```

The browser entry sends with `navigator.sendBeacon` (or `fetch` with `keepalive`) as `text/plain`, so there is no CORS preflight. It flushes the queue when the page becomes hidden.

## Node and Bun

```ts
import { init, track, shutdown } from "trackin/node";

init({ endpoint: "https://example.com/events" });
track("job_done", { ms: 120 });

// Call shutdown() before process.exit().
await shutdown();
```

The timer does not keep the process alive. The queue is flushed on `beforeExit`, but not on `process.exit()` or on a signal, so call `shutdown()` yourself in those cases.

## React Native

```ts
import { AppState } from "react-native";
import { init, track } from "trackin/react-native";

init({ endpoint: "https://example.com/events", appState: AppState });
track("screen_view", { name: "Home" });
```

Pass `AppState` so the library flushes when the app goes to the background. trackin does not import `react-native` itself.

## More than one tracker

`init()` makes one shared tracker for `track()`, `flush()` and `shutdown()`. To make your own, use `createTracker` with the same options:

```ts
import { createTracker } from "trackin";

const tracker = createTracker({ endpoint: "https://example.com/events", source: "node" });
tracker.track("job_done");
```

## Options

- `endpoint`: URL of `POST /events`. Not needed when you give a `transport`.
- `transport`: a function `(events) => Promise<void>` that replaces the default sender. Throw to keep the batch for the next flush. Throw an error with a `status` of 400 to 499 (not 408 or 429) to drop the batch.
- `beforeSend`: change an event, or return `null` or `false` to drop it.
- `batchSize`: send when the queue has this many events. Default 20. Values above 100 become 100. A batch also stops at 60 KB of JSON.
- `flushInterval`: send every this many ms. `0` turns the timer off. Default 5000.
- `maxQueue`: drop the oldest events above this size. Default 1000.
- `disabled`: when `true`, `track()` does nothing. Use it for opt-out.
- `onError`: called when a send fails or an event is dropped.
- `source`: `"browser"`, `"node"`, `"bun"` or `"react-native"`. Each entry sets it for you.

Call `flush()` to send the queue now.

## Events

The client sends a JSON array of events:

```json
[{ "id": "…uuid…", "ts": 1763000000000, "name": "signup_clicked", "session_id": "…uuid…", "source": "browser", "props": { "plan": "pro" } }]
```

Props are a flat object of strings, numbers, booleans and `null`. A failed send is retried with the same ids, and the server ignores ids it already has, so a retry does not make duplicates.

## Server

Both servers accept `POST /events`. They use the same validation from `trackin/ingest` and the same `events` table:

| column       | type    |                                   |
| ------------ | ------- | --------------------------------- |
| `id`         | TEXT    | primary key, from the client      |
| `ts`         | INTEGER | ms since epoch, from the client   |
| `received`   | INTEGER | ms since epoch, from the server   |
| `name`       | TEXT    |                                   |
| `session_id` | TEXT    |                                   |
| `source`     | TEXT    |                                   |
| `props`      | TEXT    | JSON                              |

Limits: 64 KB per request, 100 events per request, names up to 200 characters, props up to 2 KB of JSON, session ids up to 64 characters, and `ts` from 30 days ago to one day ahead. A request that is too large gets `413`. Events that are not valid are skipped, and the answer says how many: `{ "accepted": 3, "rejected": 1 }`.

> **The endpoint is open.** There are no API keys yet, and CORS allows any origin. Anyone who knows the URL can send events to it. Keep this in mind before you use it in production.

### Bun (self-hosted)

From a clone of this repository:

```sh
bun run server
```

The server listens on port `3000`. Set `PORT` to change it. Set `DB_PATH` to choose the SQLite file (default `trackin.sqlite`).

Or from the package, in your own Bun program:

```ts
import { startServer } from "trackin/server";

startServer({ port: 3000, db: "trackin.sqlite" });
```

`trackin/server` uses `bun:sqlite`, so it runs on Bun only.

### Cloudflare Worker

The Worker is `src/worker.ts`. The migration `migrations/0000_create_events_table.sql` creates the `events` table in D1. From a clone of this repository:

1. Copy `wrangler.example.jsonc` to `wrangler.jsonc`.
2. Create the D1 database: `bunx wrangler d1 create trackin`.
3. Copy the `database_id` that it prints into `wrangler.jsonc`.
4. Create the table on Cloudflare: `bun run worker:migrate`.
5. Deploy the Worker: `bun run worker:deploy`.

To run the Worker on your computer, run `bun run worker:migrate:local` once, then `bun run worker:dev`.

In your own Worker project, you can use the package instead: `export { default } from "trackin/worker";`, with a D1 binding named `DB` and the migration from `node_modules/trackin/migrations`.

### Other databases

`handleIngest(request, write)` from `trackin/ingest` validates a request and calls `write(rows, received)` with the valid rows. Use it to write to another database.

## Development

- `bun test` runs the tests.
- `bun run typecheck` checks the types.
- `bun run build` builds `dist/` for npm.
- `bun run size` bundles the browser entry and prints its gzip size.
- `bun run scripts/demo.ts` starts a server, sends events and prints the rows.
- `bun run scripts/send.ts <endpoint>` sends three events to an endpoint.
- `bun run worker:dev` runs the Cloudflare Worker on your computer with `wrangler dev`.
- `bun run worker:deploy` deploys the Cloudflare Worker.
- `bun run worker:migrate` and `bun run worker:migrate:local` apply the D1 migrations on Cloudflare and on your computer.

To change the table, add a new migration with `bunx wrangler d1 migrations create trackin <MESSAGE>`. Make the same change in `openDatabase()` in `src/server.ts`.

## License

MIT
