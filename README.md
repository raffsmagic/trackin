# trackin

A tiny event tracking library in TypeScript. It has no dependencies. It batches events, gives each event a client-side id, and sends them to a small server. You can self-host a Bun server that writes to SQLite, or deploy a Cloudflare Worker that writes to Cloudflare D1.

## Server

Both servers accept `POST /events` with a JSON array of events. They use the same validation from `src/ingest.ts` and the same `events` table.

### Bun (self-hosted)

Run the ingest server with Bun:

```sh
bun run server
```

The server listens on port `3000`. Set `PORT` to change it. Set `DB_PATH` to choose the SQLite file.

### Cloudflare Worker

The Worker is `src/worker.ts`. Its config is `wrangler.jsonc`. The migration `migrations/0000_create_events_table.sql` creates the `events` table in D1.

1. Create the D1 database: `bunx wrangler d1 create trackin`.
2. Copy the `database_id` that it prints into `wrangler.jsonc`.
3. Create the table on Cloudflare: `bun run worker:migrate`.
4. Deploy the Worker: `bun run worker:deploy`.

To run the Worker on your computer, run `bun run worker:migrate:local` once, then `bun run worker:dev`.

To change the table, add a new migration with `bunx wrangler d1 migrations create trackin <MESSAGE>`. Make the same change in `openDatabase()` in `src/server.ts`.

## Browser

```ts
import { init, track } from "trackin/browser";

init({ endpoint: "http://localhost:3000/events" });
track("signup_clicked", { plan: "pro" });
```

The library flushes the queue when the page becomes hidden.

## Node and Bun

```ts
import { init, track, shutdown } from "trackin/node";

init({ endpoint: "http://localhost:3000/events" });
track("job_done", { ms: 120 });

// Call shutdown() before process.exit().
await shutdown();
```

## React Native

```ts
import { AppState } from "react-native";
import { init, track } from "trackin/react-native";

init({ endpoint: "https://example.com/events", appState: AppState });
track("screen_view", { name: "Home" });
```

Pass `AppState` so the library flushes when the app goes to the background.

## Options

- `endpoint`: URL of `POST /events`. Not needed when you give a `transport`.
- `transport`: a function that replaces the default sender.
- `beforeSend`: change an event, or return `null` or `false` to drop it.
- `batchSize`: send when the queue has this many events. Default 20. Values above 100 become 100.
- `flushInterval`: send every this many ms. `0` turns the timer off. Default 5000.
- `maxQueue`: drop the oldest events above this size. Default 1000.
- `disabled`: when `true`, `track()` does nothing.
- `onError`: called when a send fails.

Call `flush()` to send the queue now.

## Commands

- `bun test` runs the tests.
- `bun run build` bundles the browser entry and prints its gzip size.
- `bun run worker:dev` runs the Cloudflare Worker on your computer with `wrangler dev`.
- `bun run worker:deploy` deploys the Cloudflare Worker.
- `bun run worker:migrate` and `bun run worker:migrate:local` apply the D1 migrations on Cloudflare and on your computer.
