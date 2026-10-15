import { expect, test } from "bun:test";
import { closedNetByCoin, EmaStep, orderSize, readBacktestReport, runBacktest, type BacktestOpts } from "../src/backtest";
import type { Ohlc } from "../src/chart";
import { emaSeries } from "../src/strategy";

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

test("closedNetByCoin sums closed trades after fees and leaves open ones out", async () => {
  const t = (pnlUsd: number, exitTs: number | null) => ({ side: "long" as const, entryTs: 1, entryPx: 1, exitTs, exitPx: 1, size: 1, pnlUsd, feesUsd: 0, maxAdversePct: 0 });
  expect(closedNetByCoin({ tradesByCoin: { BTC: [t(1.5, 2), t(-0.25, 3), t(9, null)], ETH: [] } })).toEqual({ BTC: 1.25, ETH: 0 });
  expect(closedNetByCoin(null)).toEqual({});
  expect(await readBacktestReport("/nonexistent/latest.json")).toBeNull();
});
