import { expect, test } from "bun:test";
import { channelForView, parseLevels } from "../web/src/lib/levels";

const M15 = 15 * 60_000;
const H = 60 * 60_000;
/** One 15m channel point per bar from 0 to 8h, long = bar index, short = 100 + index. */
const points = Array.from({ length: 33 }, (_, i) => ({ ts: i * M15, long: i, short: 100 + i }));

test("15m view: each bar gets its own channel value", () => {
  const ch = channelForView(points, [0, M15 / 1000, (2 * M15) / 1000], "15m", null)!;
  expect(ch.long.map((p) => p.value)).toEqual([0, 1, 2]);
  expect(ch.short.map((p) => p.value)).toEqual([100, 101, 102]);
});

test("1H and 4H views: the value at the last 15m bar inside each bar", () => {
  expect(channelForView(points, [0, H / 1000], "1H", null)!.long.map((p) => p.value)).toEqual([3, 7]);
  expect(channelForView(points, [0, (4 * H) / 1000], "4H", null)!.long.map((p) => p.value)).toEqual([15, 31]);
});

test("1m view: the 15m bar each minute sits in, and the live tick replaces the newest bar", () => {
  const times = [0, 14 * 60, 15 * 60, 16 * 60];
  const ch = channelForView(points, times, "1m", { long: 9, short: 99, timeframe: "15m" })!;
  expect(ch.long).toEqual([
    { time: 0, value: 0 },
    { time: 840, value: 0 },
    { time: 900, value: 1 },
    { time: 960, value: 9 },
  ]);
});

test("bars before the channel is seeded get no line; no data means no lines", () => {
  const late = points.slice(8);
  expect(channelForView(late, [0, H / 1000, (2 * H) / 1000], "1H", null)!.long.map((p) => p.time)).toEqual([7200]);
  expect(channelForView([], [0], "1H", null)).toBeNull();
  expect(channelForView(points, [], "1H", null)).toBeNull();
});

test("parseLevels drops bad rows and sorts", () => {
  expect(parseLevels({ BTC: [{ ts: 2, long: 1, short: 3 }, { ts: 1, long: 1, short: 3 }, { ts: 3, long: 0, short: 1 }], ETH: "x" })).toEqual({
    BTC: [{ ts: 1, long: 1, short: 3 }, { ts: 2, long: 1, short: 3 }],
  });
  expect(parseLevels(null)).toEqual({});
});
