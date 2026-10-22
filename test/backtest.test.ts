import { expect, test } from "bun:test";
import { closedNetByCoin, EmaStep, orderSize, readBacktestReport, runBacktest, type BacktestOpts } from "../src/backtest";
import type { Ohlc } from "../src/chart";
import { emaSeries, firstPriceRestart, SCRIPT_RULES, strategyCall } from "../src/strategy";

const M = 60_000;
const Q = 15 * M;
/** 1m candles at 100 with a 0.2% wick: lines sit near 101.85 (short) and 98.18 (long). */
const calm = (n: number, from = 0): Ohlc[] =>
  Array.from({ length: n }, (_, i) => ({ ts: from + i * M, open: 100, high: 100.2, low: 99.8, close: 100 }));
const bar = (ts: number, b: Partial<Ohlc>): Ohlc => ({ ts, open: 100, high: 100.2, low: 99.8, close: 100, ...b });

const opts: BacktestOpts = {
  startTs: 0, leverage: 15, quoteUsd: 40, qtyStep: 0.001, minQty: 0.001, minNotional: 5, makerFee: 0.0002, takerFee: 0.00055,
};
/** 130 calm 15m periods, enough to seed the 125-bar EMA. */
const WARM = 130 * 15;

test("EmaStep gives the same values as Pine emaSeries, and peek is the forming bar", () => {
  const xs = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 3 + (i % 5));
  const e = new EmaStep(125);
  for (let i = 0; i < xs.length - 1; i++) e.push(xs[i]!);
  expect(e.peek(xs.at(-1)!)).toBeCloseTo(emaSeries(xs, 125).at(-1)!, 9);
  expect(Number.isNaN(new EmaStep(3).peek(1))).toBe(true);
});

test("orderSize matches the live quote size: QUOTE_USD floored to the step, never under the minimum", () => {
  expect(orderSize(101.9, opts)).toBe(0.392);
  expect(orderSize(100, { ...opts, quoteUsd: 1 })).toBe(0.05);
});

test("a short posts at the touch, fills when the next minute trades through, and closes at the long line", () => {
  const t0 = WARM * M;
  const r = runBacktest([
    ...calm(WARM),
    bar(t0, { high: 102, close: 101.9 }),      // high above the short line: post short at 101.9
    bar(t0 + M, { high: 102, close: 101.9 }),  // trades through 101.9: filled
    ...calm(30, t0 + 2 * M),
    bar(t0 + 32 * M, { low: 97, close: 97.5 }), // close below the long line: take short profit
  ], opts);
  expect(r.trades).toHaveLength(1);
  const t = r.trades[0]!;
  expect(t).toMatchObject({ side: "short", entryPx: 101.9, exitPx: 97.5, size: 0.392, exitTs: t0 + 33 * M });
  const fees = 101.9 * 0.392 * 0.0002 + 97.5 * 0.392 * 0.00055;
  expect(t.pnlUsd).toBeCloseTo((101.9 - 97.5) * 0.392 - fees, 9);
  expect(r.pnlUsd).toBeCloseTo(t.pnlUsd, 9);
  expect(r.missedEntries).toBe(0);
});

test("an entry that never fills is cancelled once the signal is gone", () => {
  // Spike on the last minute of a 15m period, then a fresh period inside the channel.
  const last = (WARM + 14) * M;
  const r = runBacktest([...calm(WARM + 14), bar(last, { high: 102, close: 101.9 }), ...calm(5, last + M)], opts);
  expect(Math.floor(last / Q)).not.toBe(Math.floor((last + M) / Q));
  expect(r.trades).toHaveLength(0);
  expect(r.missedEntries).toBe(1);
});

test("bars before startTs only warm up: no trades there", () => {
  const t0 = WARM * M;
  const r = runBacktest([...calm(WARM), bar(t0, { high: 102, close: 101.9 }), bar(t0 + M, { high: 102, close: 101.9 })], {
    ...opts, startTs: t0 + 5 * M,
  });
  expect(r.trades).toHaveLength(0);
  expect(r.ticks).toBe(0);
});

test("a position still open at the end is marked at the last close, with no exit fee", () => {
  const t0 = WARM * M;
  const r = runBacktest([...calm(WARM), bar(t0, { high: 102, close: 101.9 }), bar(t0 + M, { high: 102, close: 101 })], opts);
  expect(r.trades).toHaveLength(1);
  expect(r.trades[0]).toMatchObject({ exitTs: null, exitPx: 101 });
  expect(r.trades[0]!.pnlUsd).toBeCloseTo((101.9 - 101) * 0.392 - 101.9 * 0.392 * 0.0002, 9);
});

test("stop loss closes at the tick price once past the stop, like the live bot, then that side waits", () => {
  const t0 = WARM * M;
  const r = runBacktest([
    ...calm(WARM),
    bar(t0, { high: 102, close: 101.9 }),         // short posted at 101.9
    bar(t0 + M, { high: 102, close: 101.9 }),     // filled
    bar(t0 + 2 * M, { high: 105.6, close: 104 }), // wick past the 3% stop (104.957), close under it: no stop
    bar(t0 + 3 * M, { high: 105.6, close: 105.5 }), // close past the stop: stopped at 105.5
    ...calm(5, t0 + 4 * M),                        // same 15m bar: high still above the short line
  ], { ...opts, stopPct: 0.03 });
  expect(r.stops).toBe(1);
  expect(r.trades).toHaveLength(1);
  expect(r.trades[0]).toMatchObject({ exitPx: 105.5, exitTs: t0 + 4 * M });
});

test("mid exit takes profit at the channel middle instead of the far line", () => {
  const t0 = WARM * M;
  const r = runBacktest([
    ...calm(WARM),
    bar(t0, { high: 102, close: 101.9 }),
    bar(t0 + M, { high: 102, close: 101.9 }),
    bar(t0 + 2 * M, { close: 100 }),
  ], { ...opts, exit: "mid" });
  expect(r.trades).toHaveLength(1);
  expect(r.trades[0]).toMatchObject({ side: "short", exitPx: 100, exitTs: t0 + 3 * M });
});

test("onBarClose decides only as a 15m bar closes", () => {
  const t0 = WARM * M; // a 15m boundary
  const r = runBacktest([...calm(WARM), bar(t0, { high: 102, close: 100 }), ...calm(20, t0 + M)], { ...opts, onBarClose: true });
  expect(r.trades).toHaveLength(1);
  // Posted at the bar close (t0 + 15m), filled in the next minute.
  expect(r.trades[0]!.entryTs).toBe(t0 + 15 * M);
  const live = runBacktest([...calm(WARM), bar(t0, { high: 102, close: 100 }), ...calm(20, t0 + M)], opts);
  expect(live.trades[0]!.entryTs).toBeLessThan(t0 + 15 * M);
});

test("exitLive takes a short's profit inside the bar; bar close alone waits for a close below the line", () => {
  const t0 = WARM * M; // a 15m boundary
  const rows = [
    ...calm(WARM),
    bar(t0, { high: 102, close: 100 }),            // short signal on this bar's close
    ...calm(16, t0 + M),                            // posted at t0 + 15m, filled the next minute
    bar(t0 + 17 * M, { low: 97.9, close: 98 }),    // tick price 98 is under the long line ~98.18
    ...calm(30, t0 + 18 * M),                       // the bar closes back at 100
  ];
  const live = runBacktest(rows, { ...opts, onBarClose: true, exitLive: true });
  expect(live.trades[0]).toMatchObject({ side: "short", exitPx: 98, exitTs: t0 + 18 * M });
  const atClose = runBacktest(rows, { ...opts, onBarClose: true });
  expect(atClose.trades[0]!.exitTs).toBeNull();
});

test("partialTp closes 70% at the channel middle as its own trade and keeps the rest open", () => {
  const t0 = WARM * M;
  const rows = [
    ...calm(WARM),
    bar(t0, { high: 102, close: 101.9 }),     // short signal, post at 101.9
    bar(t0 + M, { high: 102, close: 101.9 }), // filled
    bar(t0 + 2 * M, { close: 99.9 }),         // tick price under the middle (~100): take 70%
    ...calm(10, t0 + 3 * M),
  ];
  const r = runBacktest(rows, { ...opts, partialTp: 0.7 });
  expect(r.trades).toHaveLength(2);
  const [part, rest] = r.trades;
  expect(part).toMatchObject({ side: "short", partial: true, exitPx: 99.9, exitTs: t0 + 3 * M });
  expect(part!.size).toBeCloseTo(0.274, 9); // 70% of 0.392, floored to the step
  expect(rest).toMatchObject({ side: "short", exitTs: null, entries: [{ ts: t0 + M, px: 101.9, size: 0.392 }] });
  expect(rest!.size).toBeCloseTo(0.118, 9);
  expect(rest!.partial).toBeUndefined();
});

test("swingStop closes after the last add once the price breaks the low between the last two entries", () => {
  const t0 = WARM * M;
  const rows = [
    ...calm(WARM),
    bar(t0, { low: 97, close: 98 }),          // long signal: post at 98
    bar(t0 + M, { low: 97.5, close: 98 }),    // filled (entry 1)
    ...calm(20, t0 + 2 * M),
    bar(t0 + 22 * M, { low: 97, close: 98 }), // signal again after 1 bar: entry 2 posts
    bar(t0 + 23 * M, { low: 96.5, close: 98 }), // filled (entry 2); low 96.5
    ...calm(20, t0 + 24 * M),
    bar(t0 + 44 * M, { low: 97, close: 98 }), // entry 3 posts
    bar(t0 + 45 * M, { low: 97.2, close: 98 }), // filled (entry 3): level = 96.5
    bar(t0 + 46 * M, { low: 96.6, close: 96.6 }), // above the level: held
    bar(t0 + 47 * M, { low: 96.3, close: 96.4 }), // under 96.5: stop
    ...calm(5, t0 + 48 * M),
  ];
  const r = runBacktest(rows, { ...opts, maxAdds: 2, addGapBars: [1], swingStop: true });
  expect(r.trades[0]).toMatchObject({ side: "long", exitPx: 96.4, exitTs: t0 + 48 * M });
  expect(r.trades[0]!.entries).toHaveLength(3);
  expect(r.stops).toBe(1);
});

test("firstPriceTp closes 2/3 at the first entry's price after the last add and keeps the rest", () => {
  const t0 = WARM * M;
  const rows = [
    ...calm(WARM),
    bar(t0, { low: 97, close: 98 }),            // long signal: post at 98
    bar(t0 + M, { low: 97.5, close: 98 }),      // entry 1 at 98
    ...calm(20, t0 + 2 * M),
    bar(t0 + 22 * M, { low: 97, close: 97.5 }),
    bar(t0 + 23 * M, { low: 97, close: 97.5 }), // entry 2 at 97.5
    ...calm(20, t0 + 24 * M),
    bar(t0 + 44 * M, { low: 96.9, close: 97 }),
    bar(t0 + 45 * M, { low: 96.9, close: 97 }), // entry 3 at 97
    bar(t0 + 46 * M, { close: 98 }),            // back to entry 1: take 2/3
    ...calm(5, t0 + 47 * M),
  ];
  const r = runBacktest(rows, { ...opts, maxAdds: 2, addGapBars: [1], firstPriceTp: 2 / 3 });
  const [part, rest] = r.trades;
  expect(part).toMatchObject({ side: "long", partial: true, exitPx: 98 });
  expect(part!.entries).toHaveLength(3);
  expect(part!.size + rest!.size).toBeCloseTo(0.408 + 0.41 + 0.412, 9); // $40 at 98, 97.5, 97
  expect(part!.size).toBeCloseTo(0.82, 9); // 2/3 of 1.23
  expect(rest!.exitTs).toBeNull();
});

test("after the 2/3 take profit the rest counts as entry 1, so the next signal is entry 2 and the cycle repeats", () => {
  const t0 = WARM * M;
  const dip = (ts: number, px: number) => [bar(ts, { low: px - 0.5, close: px }), bar(ts + M, { low: px - 0.5, close: px })];
  const rows = [
    ...calm(WARM),
    ...dip(t0, 98),                       // entry 1 at 98
    ...calm(20, t0 + 2 * M),
    ...dip(t0 + 22 * M, 97.5),            // entry 2
    ...calm(20, t0 + 24 * M),
    ...dip(t0 + 44 * M, 97),              // entry 3
    bar(t0 + 46 * M, { close: 98 }),      // back to entry 1: take 2/3, the rest is entry 1
    ...calm(20, t0 + 47 * M),
    ...dip(t0 + 67 * M, 97.5),            // re-entry: entry 2
    ...calm(20, t0 + 69 * M),
    ...dip(t0 + 89 * M, 97),              // entry 3 again
    bar(t0 + 91 * M, { close: 98 }),      // back to entry 1 again: take 2/3 again
    ...calm(5, t0 + 92 * M),
  ];
  const r = runBacktest(rows, { ...opts, maxAdds: 2, addGapBars: [1], firstPriceTp: 2 / 3 });
  const parts = r.trades.filter((t) => t.partial);
  expect(parts).toHaveLength(2);
  expect(parts.map((t) => t.exitPx)).toEqual([98, 98]);
  const last = r.trades.at(-1)!;
  expect(last.exitTs).toBeNull();
  expect(last.entries?.map((e) => e.round)).toEqual([undefined, undefined, undefined, 2, 3]);
});

test("after the re-entry (entry 2), the price of the 2/3 take profit takes 50%, and the rest is entry 1 again", () => {
  const t0 = WARM * M;
  const dip = (ts: number, px: number) => [bar(ts, { low: px - 0.5, close: px }), bar(ts + M, { low: px - 0.5, close: px })];
  const rows = [
    ...calm(WARM),
    ...dip(t0, 98),                       // entry 1 at 98
    ...calm(20, t0 + 2 * M),
    ...dip(t0 + 22 * M, 97.5),            // entry 2
    ...calm(20, t0 + 24 * M),
    ...dip(t0 + 44 * M, 97),              // entry 3
    bar(t0 + 46 * M, { high: 98.3, close: 98.2 }), // past entry 1: take 2/3 at 98.2
    ...calm(20, t0 + 47 * M),
    ...dip(t0 + 67 * M, 97.5),            // re-entry: entry 2
    bar(t0 + 69 * M, { high: 98.1, close: 98.1 }), // under 98.2: holds
    bar(t0 + 70 * M, { high: 98.25, close: 98.2 }), // back to 98.2: take 50%
    ...calm(20, t0 + 71 * M),
    ...dip(t0 + 91 * M, 97.5),            // entry 2 again (back at 98.2 it would take 50% again)
    bar(t0 + 93 * M, { close: 97.6 }),
  ];
  const r = runBacktest(rows, { ...opts, maxAdds: 2, addGapBars: [1], firstPriceTp: 2 / 3, retakeTp: 0.5 });
  const parts = r.trades.filter((t) => t.partial);
  expect(parts.map((t) => t.exitPx)).toEqual([98.2, 98.2]);
  // 1.23 held: 2/3 is 0.82, the rest 0.41 plus the re-entry 0.41 is 0.82, and 50% of it is 0.41.
  expect(parts[0]!.size).toBeCloseTo(0.82, 9);
  expect(parts[1]!.size).toBeCloseTo(0.41, 9);
  const last = r.trades.at(-1)!;
  expect(last.exitTs).toBeNull();
  expect(last.entries?.map((e) => e.round)).toEqual([undefined, undefined, undefined, 2, 2]);
});

test("strategyCall retakes only after a re-entry, at the recorded take profit price", () => {
  const rules = { ...SCRIPT_RULES, maxAdds: 2, firstPriceTp: 2 / 3, retakeTp: 0.5 };
  const lines = { emaHigh: 101, emaLow: 99, shortLine: 110, longLine: 90 };
  const last = { ts: 0, open: 100, high: 100, low: 100, close: 100 };
  const call = (count: number, price: number, tpPx?: number) =>
    strategyCall(lines, last, "long", price, 99, rules, { entries: { side: "long", count, lastTs: 0, size: 1, firstPx: 99.5, tpPx }, now: 0, periodMs: 1 });
  expect(call(2, 100, 100)).toMatchObject({ intent: "close", closeFraction: 0.5 });
  expect(call(2, 99.9, 100).intent).toBe("hold");
  expect(call(2, 100).intent).toBe("hold");    // a first entry 2, no take profit before it
  expect(call(1, 100, 100).intent).toBe("hold"); // the rest alone waits for the re-entry
});

test("the run hands back the position still open, with the strategy's entry state", () => {
  const t0 = WARM * M;
  const dip = (ts: number, px: number) => [bar(ts, { low: px - 0.5, close: px }), bar(ts + M, { low: px - 0.5, close: px })];
  const rows = [
    ...calm(WARM),
    ...dip(t0, 98),                       // entry 1 at 98
    ...calm(20, t0 + 2 * M),
    ...dip(t0 + 22 * M, 97.5),            // entry 2
    bar(t0 + 24 * M, { close: 97.6 }),
  ];
  const r = runBacktest(rows, { ...opts, maxAdds: 2, addGapBars: [1], firstPriceTp: 2 / 3 });
  expect(r.open).toMatchObject({ side: "long", count: 2, firstPx: 98, entryTs: t0 + M, lastTs: t0 + 23 * M, prevTs: t0 + M });
  expect(r.open!.size).toBeCloseTo(40 / 98 + 40 / 97.5, 2);
  expect(r.open!.feesUsd).toBeGreaterThan(0);
  expect(runBacktest(calm(WARM + 5), opts).open).toBeNull();
});

test("firstPriceRestart counts the rest as entry 1 only after that take profit", () => {
  const rules = { ...SCRIPT_RULES, maxAdds: 2, firstPriceTp: 2 / 3 };
  const log = { side: "long" as const, count: 3, lastTs: 5, size: 1, trimmed: true, prevTs: 3, level: 95, firstPx: 98 };
  expect(firstPriceRestart(log, rules, 98.2)).toEqual({ side: "long", count: 1, lastTs: 5, size: 1, firstPx: 98, tpPx: 98.2 });
  // The retake after the re-entry keeps the recorded price.
  const retake = { ...log, count: 2, tpPx: 98.2 };
  expect(firstPriceRestart(retake, { ...rules, retakeTp: 0.5 }, 98.3)).toMatchObject({ count: 1, tpPx: 98.2 });
  expect(firstPriceRestart(retake, rules, 98.3)).toBe(retake); // retake off
  expect(firstPriceRestart({ ...log, trimmed: false }, rules)).toEqual({ ...log, trimmed: false });
  expect(firstPriceRestart({ ...log, count: 1 }, rules)).toEqual({ ...log, count: 1 }); // the middle take profit
  expect(firstPriceRestart(log, { ...rules, firstPriceTp: null })).toBe(log);
});

test("closedNetByCoin sums closed trades after fees and leaves open ones out", async () => {
  const t = (pnlUsd: number, exitTs: number | null) => ({ side: "long" as const, entryTs: 1, entryPx: 1, exitTs, exitPx: 1, size: 1, pnlUsd, feesUsd: 0, maxAdversePct: 0 });
  expect(closedNetByCoin({ tradesByCoin: { BTC: [t(1.5, 2), t(-0.25, 3), t(9, null)], ETH: [] } })).toEqual({ BTC: 1.25, ETH: 0 });
  expect(closedNetByCoin(null)).toEqual({});
  expect(await readBacktestReport("/nonexistent/latest.json")).toBeNull();
});

test("an add 50 bars after the entry averages in, and the trade lists both entries", () => {
  const t0 = WARM * M; // 15m bar 130
  const t1 = 181 * Q; // 50+ bars after the fill at t0 + 1m
  const tape = [
    ...calm(WARM),
    bar(t0, { high: 102, close: 101.9 }),
    bar(t0 + M, { high: 102, close: 101.9 }), // entry 1 fills
    ...calm((t1 - t0 - 2 * M) / M, t0 + 2 * M),
    bar(t1, { high: 102, close: 101.9 }), // short signal again
    bar(t1 + M, { high: 102, close: 101.9 }), // entry 2 fills
    ...calm(30, t1 + 2 * M),
    bar(t1 + 32 * M, { low: 97, close: 97.5 }), // close below the long line: take short profit
  ];
  const one = orderSize(101.9, opts);
  const adds = runBacktest(tape, { ...opts, maxAdds: 2, addGapBars: [50] });
  expect(adds.trades).toHaveLength(1);
  expect(adds.trades[0]).toMatchObject({ side: "short", exitPx: 97.5, entryTs: t0 + M });
  expect(adds.trades[0]!.entryPx).toBeCloseTo(101.9, 9);
  expect(adds.trades[0]!.size).toBeCloseTo(2 * one, 9);
  expect(adds.trades[0]!.entries).toEqual([
    { ts: t0 + M, px: 101.9, size: one },
    { ts: t1 + M, px: 101.9, size: one },
  ]);
  const script = runBacktest(tape, opts);
  expect(script.trades).toHaveLength(1);
  expect(script.trades[0]!.size).toBe(one);
  expect(script.trades[0]!.entries).toBeUndefined();
  // Too soon: with a 60-bar gap the second signal (51 bars on) is held.
  expect(runBacktest(tape, { ...opts, maxAdds: 2, addGapBars: [60] }).trades[0]!.entries).toBeUndefined();
});
