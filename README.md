# tinytrack

A tiny event tracking library in TypeScript. It has no dependencies. It batches events, gives each event a client-side id, and sends them to a small Bun server that writes to SQLite.

## Server

Run the ingest server with Bun:

```sh
bun run server
```

The server listens on port `3000`. Set `PORT` to change it. Set `DB_PATH` to choose the SQLite file. The server accepts `POST /events` with a JSON array of events.

## Browser

```ts
import { init, track } from "tinytrack/browser";

init({ endpoint: "http://localhost:3000/events" });
track("signup_clicked", { plan: "pro" });
```

The library flushes the queue when the page becomes hidden.

## Node and Bun

```ts
import { init, track, shutdown } from "tinytrack/node";

init({ endpoint: "http://localhost:3000/events" });
track("job_done", { ms: 120 });

// Call shutdown() before process.exit().
await shutdown();
```

## React Native

```ts
import { AppState } from "react-native";
import { init, track } from "tinytrack/react-native";

init({ endpoint: "https://example.com/events", appState: AppState });
track("screen_view", { name: "Home" });
```

Pass `AppState` so the library flushes when the app goes to the background.

## Options

- `endpoint`: URL of `POST /events`. Not needed when you give a `transport`.
- `transport`: a function that replaces the default sender.
- `beforeSend`: change an event, or return `null` or `false` to drop it.
- `batchSize`: send when the queue has this many events. Default 20.
- `flushInterval`: send every this many ms. `0` turns the timer off. Default 5000.
- `maxQueue`: drop the oldest events above this size. Default 1000.
- `disabled`: when `true`, `track()` does nothing.
- `onError`: called when a send fails.

Call `flush()` to send the queue now.

## Commands

- `bun test` runs the tests.
- `bun run build` bundles the browser entry and prints its gzip size.
