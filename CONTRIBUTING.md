# Contributing

Thanks for your help. trackin stays small on purpose, so please read this first.

- The library has no dependencies. Please do not add one.
- Read "What trackin does not do" in README.md. Changes that add cookies, user ids, fingerprinting or autocapture will not be merged.
- Open an issue before a large change, so we can agree on it first.

## Setup

You need [Bun](https://bun.sh).

```sh
bun install
bun test
bun run typecheck
bun run size
```

`bun run size` fails when the browser bundle is over its gzip budget. All three must pass before a pull request is merged.

If you change the `events` table, add a migration in `migrations/` and make the same change in `openDatabase()` in `src/server.ts`. A test checks that the two match.
