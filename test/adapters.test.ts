import { afterEach, expect, test } from "bun:test";
import type { TrackEvent, Transport } from "../src/core.ts";
import * as node from "../src/node.ts";
import * as rn from "../src/react-native.ts";
import { shutdown } from "../src/default.ts";

afterEach(() => shutdown());

function recorder() {
  const sent: TrackEvent[] = [];
  const transport: Transport = async (events) => {
    sent.push(...events);
  };
  return { sent, transport };
}

test("track before init does nothing", async () => {
  node.track("early");
  await node.flush();
});

test("node entry sets source to bun under Bun", async () => {
  const { sent, transport } = recorder();
  node.init({ transport, flushInterval: 0 });
  node.track("job.done", { ms: 12 });
  await node.flush();
  expect(sent[0].source).toBe("bun");
  expect(sent[0].props).toEqual({ ms: 12 });
});

test("react-native entry flushes when the app goes to the background", async () => {
  const { sent, transport } = recorder();
  let listener: (state: string) => void = () => {};
  const appState = { addEventListener: (_: "change", l: (s: string) => void) => (listener = l) };
  rn.init({ transport, appState, flushInterval: 0 });
  rn.track("screen", { name: "home" });
  expect(sent).toHaveLength(0);
  listener("background");
  await Bun.sleep(0);
  expect(sent.map((e) => e.name)).toEqual(["screen"]);
  expect(sent[0].source).toBe("react-native");
});

test("react-native init removes the AppState listener of the previous init", async () => {
  const { transport } = recorder();
  let removed = 0;
  const appState = {
    addEventListener: () => ({ remove: () => removed++ }),
  };
  rn.init({ transport, appState, flushInterval: 0 });
  rn.init({ transport, appState, flushInterval: 0 });
  expect(removed).toBe(1);
});
