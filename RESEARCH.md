# tinytrack: research notes

tinytrack is a very simple event tracking library for TypeScript.
Targets: the browser, Node and Bun servers, and React Native.

This file records how other tools do event tracking, which database to use
for raw events, and what tinytrack will NOT do.

## How to read this file

- **[source]**: the fact comes from a page in the "Sources" list at the end.
- **[unchecked]**: the fact comes from memory, not from a page we read.
  Check it before you depend on it.

Only one page was read in full: the "Design goals" section of Plausible's
`tracker/ARCHITECTURE.md`. For all other tools, we only have search snippets
or memory. Read the pages in "Sources" before the design is final.

> **Name collision:** a product named TinyTrack already exists, with docs at
> https://docs.tinytrack.io/tracking/custom-events [source]. Think about this
> before you publish a package with the name `tinytrack`.

---

## 1. Plausible (tracker script)

What the architecture page says [source]:

1. **Minimal script size.** A smaller script gives a better user experience
   and loses fewer events while the script downloads and runs. They minify
   with `@swc/core` and track the script size on each pull request.
2. **Many targets, one codebase.** One source makes the web snippet, the
   WordPress tooling and an npm package. They do it with:
   - a list of compiled variants in `tracker/compiler/variants.json`,
   - `COMPILE` globals that turn functionality on or off for each variant,
   - a minifier that removes dead branches from each variant,
   - `compile.js`, which compiles all the variants.
3. **Flexible user configuration.** Users turn features on and off without
   a change to their integration code. The server interpolates site
   configuration into the minified `plausible.js`.
4. **Legacy support.** Old installs must not break. They still make and serve
   the old variants, which used the script file extension to select features.
5. **Development experience.** Fast parallel compile (more than 1000 variants
   in about 3 seconds), rollup to split code, browser tests, CI release.

Other details [unchecked]:

- The script sends one small JSON POST for each event to `/api/event`. The
  short keys are the event name, URL, domain, referrer and props.
- It uses no cookies and no local storage. The server makes a daily
  visitor hash from IP, user agent, domain and a daily salt.
- It ignores `localhost` by default.
- The backend is an Elixir/Phoenix monolith with Postgres for application
  data [source, snippet]. Events go into ClickHouse [unchecked].

**Lessons for tinytrack:**

- Keep the browser bundle very small, and measure its size in CI.
- One core, small adapters for each target. Do not copy the variant
  compiler: we have 3 targets, not 1000 variants.
- One event = one small JSON body. Short and flat.

## 2. Umami (client tracker)

What the snippet says [source, snippet]: the client tracker is a
lightweight JavaScript library on the website. It records page views
automatically and also accepts custom events.

Other details [unchecked]:

- The script tag holds the config in `data-*` attributes, such as
  `data-website-id`, `data-domains` and `data-do-not-track`.
- It sends a POST to `/api/send` with `{ type, payload }`. The payload has
  website, hostname, URL, referrer, title, screen, language, event name and
  event data.
- The server returns a cache token that the client sends back on the next
  request, so the server does less session work.
- The JS API is `umami.track(name, data)`.
- Storage: Postgres or MySQL, with ClickHouse as an option for large sites.

**Lessons for tinytrack:**

- `track(name, props)` is the full public API that most users need.
- A "do not send on these domains / on localhost" check is cheap and useful.

## 3. PostHog (posthog-js, posthog-node, posthog-react-native)

We did not read a page about PostHog. All of this section is [unchecked].

- posthog-js is a large SDK. It has autocapture of clicks, session replay,
  feature flags, surveys, heatmaps and experiments.
- It keeps a `distinct_id` in a cookie or `localStorage`, and it merges
  anonymous and identified users with `identify` and `alias`.
- It puts events in a queue, sends them in batches, retries on failure and
  can compress the body.
- posthog-node has `flushAt` (batch size) and `flushInterval` (time) options.
  You must call `shutdown()` before the process stops, or events are lost.
- Events go into ClickHouse.

**Lessons for tinytrack:**

- The server SDK pattern is correct: batch by count or by time, and
  `flush()` / `shutdown()` before exit.
- Most of posthog-js is what we will NOT do (see the list below).

## 4. Segment (analytics.js / analytics-next, analytics-node)

What the snippet says [source, snippet]: Segment (now part of Twilio) is a
customer data platform. It collects events one time and sends them to many
downstream tools.

Other details [unchecked]:

- The API is the "Segment Spec": `track`, `identify`, `page`, `screen`,
  `group`, `alias`.
- analytics-next uses plugins in stages: before, enrichment, destination,
  after.
- The browser SDK keeps a retry queue in `localStorage`.
- analytics-node sends batches to a `/v1/batch` endpoint, with `flushAt`
  and `flushInterval`, and `closeAndFlush()` at shutdown.
- Each event has a `messageId`, so the server can remove duplicates.

**Lessons for tinytrack:**

- Give each event a client-side id, so retries do not make duplicates.
- One `POST /events` endpoint that accepts an array is enough for all
  targets.
- Do not build routing to other tools. That is Segment's product, not ours.

## 5. Aptabase

We did not read a page about Aptabase. All of this section is [unchecked].

- Privacy-first analytics for apps: mobile, desktop (Tauri, Electron) and
  React Native.
- The API is two calls: `init(appKey)` and `trackEvent(name, props)`.
- The app key contains the region (for example `A-EU-...` or `A-US-...`),
  so the SDK knows which host to send to.
- The session id is random and in memory only. It changes after about one
  hour with no events. There is no persistent user id.
- Each event carries system properties: OS name and version, app version,
  locale, SDK version, and a debug or release flag.
- Events go into a ClickHouse-based store.

**Lessons for tinytrack:**

- This is the closest model to tinytrack: two functions, an in-memory
  session id, no cookies, system properties added by the adapter.

## 6. Other useful reference: Trackkit

What the snippet says [source, snippet]: Trackkit has a facade (an instance
or a singleton) in front of a pipeline: a PolicyGate (DNT, domain/paths,
localhost), a ConsentManager, then a QueueService.

**Lesson for tinytrack:** a small "gate, then queue, then transport"
pipeline is a clean shape for the core.

---

## 7. Database for raw events

We did not read a page about databases. All of this section is [unchecked].
Do a benchmark with real event data before the decision is final.

Raw events are append-only, write-heavy and read with aggregate queries
(count by name, by day). A columnar store is the best fit at scale. For a
very simple library, the smallest working setup is more important.

| Option | Cost | Speed for raw events | Notes |
| --- | --- | --- | --- |
| SQLite (WAL mode, inserts in batches in one transaction) | Free, one file, no server | Many thousands of rows/s on one machine with batches | `bun:sqlite` is built in to Bun. One writer at a time. Aggregates slow down at hundreds of millions of rows. |
| DuckDB | Free, embedded | Very fast aggregate queries (columnar) | One writer process. Good to query Parquet or NDJSON files directly. |
| ClickHouse | Free to self-host; paid cloud | Very fast ingest and queries, high compression | Plausible, PostHog and Umami (option) use it. More to operate. Wants large batches, not one row per insert. |
| Postgres | Free; most hosts have it | Good to tens of millions of rows | Familiar. Row store, so large aggregates are slower and use more disk. |
| NDJSON / Parquet files on object storage (S3, R2) | Cheapest storage | Writes are very cheap; query with DuckDB | No server for storage. Queries are not real-time. |

**Recommendation [unchecked]:**

1. **v1: SQLite.** One `events` table, inserts in batches, props in a JSON
   column. No extra server, nothing to pay, and fast enough for one machine.
2. **Keep the event shape flat and ClickHouse-compatible** (see below), so
   a move to ClickHouse later is only an export and an import.
3. **When one machine is not enough: ClickHouse.** It is the choice of
   Plausible and PostHog for the same data.

Proposed `events` table:

```sql
CREATE TABLE events (
  id         TEXT PRIMARY KEY,   -- client-side id, removes duplicates on retry
  ts         INTEGER NOT NULL,   -- ms since epoch, set by the client
  received   INTEGER NOT NULL,   -- ms since epoch, set by the server
  name       TEXT NOT NULL,
  session_id TEXT,
  source     TEXT NOT NULL,      -- 'browser' | 'node' | 'bun' | 'react-native'
  props      TEXT                -- JSON object
);
CREATE INDEX events_name_ts ON events (name, ts);
```

---

## 8. What tinytrack will do (summary)

- Public API: `init({ endpoint, transport?, beforeSend?, batchSize?,
  flushInterval?, maxQueue?, disabled? })`, `track(name, props?)`,
  `flush()`, `shutdown()`.
- One core in plain TypeScript with no dependencies (`src/core.ts`). It makes
  the event with a client-side id, checks the gate, runs `beforeSend`, puts
  the event in a queue and sends batches.
- `beforeSend(event)` is the one hook. It can change the event, or return
  `null` to drop it.
- The transport is swappable: a function `(events) => Promise<void>`. The
  default is `fetch`. If it fails, the batch stays in the queue.
- Batches: send at `batchSize` events (default 20) or every
  `flushInterval` ms (default 5000).
- Small adapters for each target:
  - **browser:** `navigator.sendBeacon` or `fetch` with `keepalive`; flush
    when the page becomes hidden.
  - **Node / Bun:** `fetch`, batch by count and by time, flush on exit.
  - **React Native:** `fetch`, flush when the app goes to the background.
- One endpoint, `POST /events`, that accepts an array of events. A small Bun
  server (`src/server.ts`) writes them to SQLite with `bun:sqlite`.
- A random session id in memory only.
- A size limit for the browser bundle, checked in CI.

## 9. What tinytrack will NOT do

- **No autocapture.** We do not record clicks, inputs or page views
  automatically. The user calls `track()`.
- **No session replay, heatmaps or screen recording.**
- **No feature flags, experiments or surveys.**
- **No cookies, no `localStorage` user ids and no fingerprinting.**
- **No user identity.** No `identify`, `alias`, `group` or merging of users
  across devices.
- **No routing to other tools.** No destinations and no plugin stages like
  Segment.
- **No consent manager or banner.** We give one `disabled` / opt-out option.
  The app owns consent.
- **No persistent offline queue in v1.** The queue is in memory. Events
  that are not sent when the process or page stops are lost.
- **No build-time variants.** No `variants.json` and no legacy script
  variants like Plausible. One package with one entry for each target.
- **No dashboard in v1.** Query the database with SQL.
- **No GeoIP, user agent parsing or other server enrichment in v1.**
- **No sampling.** Every event that `track()` receives is sent, unless
  `beforeSend` drops it.
- **No multi-tenant hosting, accounts or billing.**
- **No compatibility with Google Analytics, Segment or PostHog APIs.**

## 10. Open questions

- ~~Does tinytrack include the ingest server, or only the client SDKs?~~
  Yes: v1 includes a small Bun server for `POST /events`.
- Is the `tinytrack` name free on npm, given the existing TinyTrack product?
- Must the browser adapter respect Do Not Track by default?
- What is the size limit for the browser bundle (for example 1 kB gzip)?

## Sources

- Plausible, `tracker/ARCHITECTURE.md` at v3.2.1, section "Design goals"
  (read): https://github.com/plausible/analytics/blob/v3.2.1/tracker/ARCHITECTURE.md
- Umami client-side tracker (snippet only):
  https://deepwiki.com/umami-software/umami/4.1-client-side-tracker
- Umami overview (snippet only): https://deepwiki.com/umami-software/umami
- Plausible event ingestion pipeline (snippet only):
  https://deepwiki.com/plausible/analytics/3-event-ingestion-pipeline
- How Plausible Community Edition is built (snippet only):
  https://flaviocopes.com/how-plausible-analytics-is-built/
- Segment overview (snippet only):
  https://stackoptic.com/technologies/analytics/segment
- Trackkit architecture (snippet only):
  https://trackkit.enkosiventures.com/overview/architecture
- TinyTrack custom events, an existing product with the same name
  (snippet only): https://docs.tinytrack.io/tracking/custom-events
- No page was read for posthog-js, Aptabase or the database comparison.
