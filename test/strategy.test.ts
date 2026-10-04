import { expect, test } from "bun:test";
import type { Ohlc } from "../src/chart";
import { resolveModel } from "../src/config";
import { StrategyModel, type TradeState } from "../src/model";
import { emaSeries, MAGINGA, magingaDecision, magingaLines, withLiveBar } from "../src/strategy";

const M = 60_000;
const Q = 15 * M;
/** n flat bars at `px` with a 0.2% high/low wick, `step` apart (1m by default). */
const flat = (n: number, px = 100, step = M): Ohlc[] =>
  Array.from({ length: n }, (_, i) => ({ ts: i * step, open: px, high: px * 1.002, low: px * 0.998, close: px }));
const withLast = (bars: Ohlc[], last: Partial<Ohlc>): Ohlc[] => [...bars.slice(0, -1), { ...bars.at(-1)!, ...last }];

test("MODEL accepts mock, jev, strategy; the strategy runs on 15m only", () => {
  expect(resolveModel(undefined)).toBe("mock");
  expect(resolveModel("Strategy")).toBe("strategy");
  expect(resolveModel("jev")).toBe("jev");
  expect(() => resolveModel("pine")).toThrow();
  expect(MAGINGA.timeframe).toBe("15m");
  expect(MAGINGA.periodMs).toBe(15 * 60_000);
});

test("emaSeries matches Pine: SMA seed, then alpha = 2/(len+1)", () => {
  const e = emaSeries([1, 2, 3, 4, 5], 3);
  expect(Number.isNaN(e[0]!)).toBe(true);
  expect(Number.isNaN(e[1]!)).toBe(true);
  expect(e[2]).toBe(2);
  expect(e[3]).toBe(3);
  expect(e[4]).toBe(4);
  expect(emaSeries([1, 2], 3).every(Number.isNaN)).toBe(true);
});

test("channel lines sit 1.618% / 1.619% outside the EMA(125) of highs and lows", () => {
  const l = magingaLines(flat(200))!;
  expect(l.emaHigh).toBeCloseTo(100.2, 8);
  expect(l.emaLow).toBeCloseTo(99.8, 8);
  expect(l.shortLine).toBeCloseTo(100.2 * 1.01618, 8);
  expect(l.longLine).toBeCloseTo(99.8 * (1 - 0.01619), 8);
  expect(magingaLines(flat(MAGINGA.emaLen - 1))).toBeNull();
});

test("flat: high above the short line enters short, close below the long line enters long", () => {
  const bars = flat(200);
  expect(magingaDecision(withLast(bars, { high: 102 }), "flat")).toMatchObject({ intent: "open", bias: "short" });
  expect(magingaDecision(withLast(bars, { low: 97, close: 98 }), "flat")).toMatchObject({ intent: "open", bias: "long" });
  expect(magingaDecision(bars, "flat").intent).toBe("hold");
});

test("long a low wick alone is not a long entry: Pine detect_long uses close", () => {
  expect(magingaDecision(withLast(flat(200), { low: 97, close: 100 }), "flat").intent).toBe("hold");
});

test("in a position it only closes at the opposite line, never adds", () => {
  const bars = flat(200);
  expect(magingaDecision(withLast(bars, { high: 102 }), "long")).toMatchObject({ intent: "close" });
  expect(magingaDecision(withLast(bars, { low: 97, close: 98 }), "short")).toMatchObject({ intent: "close" });
  expect(magingaDecision(withLast(bars, { high: 102 }), "short").intent).toBe("hold");
  expect(magingaDecision(withLast(bars, { low: 97, close: 98 }), "long").intent).toBe("hold");
  expect(magingaDecision(bars, "long").intent).toBe("hold");
});

test("warming up holds", () => {
  expect(magingaDecision(flat(10), "flat")).toMatchObject({ intent: "hold" });
  expect(magingaDecision(flat(10), "flat").reason).toContain("warming up");
});

test("withLiveBar folds the mid into the forming bar or opens a new one", () => {
  const bars = flat(3);
  const inBar = withLiveBar(bars, 103, 2 * M + 5_000, M);
  expect(inBar.length).toBe(3);
  expect(inBar.at(-1)).toMatchObject({ ts: 2 * M, high: 103, close: 103 });
  const next = withLiveBar(bars, 99, 3 * M + 5_000, M);
  expect(next.length).toBe(4);
  expect(next.at(-1)).toEqual({ ts: 3 * M, open: 100, high: 99, low: 99, close: 99 });
});

const state = (mid: number, side: "long" | "short" | "flat"): TradeState => ({
  position: { side, leverage: null } as TradeState["position"],
  mid,
  maxLeverage: 50,
  coin: "BTC",
} as TradeState);

test("StrategyModel decides every tick from the live price, at the strategy leverage", async () => {
  const bars = flat(200, 100, Q);
  const m = new StrategyModel(() => bars, 3, () => 199 * Q + 1_000);
  const spike = await m.decide(state(102, "flat"));
  expect(spike).toMatchObject({ action: "sell", intent: "open", bias: "short", leverage: 3 });
  const calm = await m.decide(state(100, "flat"));
  expect(calm).toMatchObject({ action: "hold", intent: "hold" });
  const exit = await m.decide(state(102, "long"));
  expect(exit).toMatchObject({ action: "sell", intent: "close" });
});

test("StrategyModel reports the channel lines so the chart can draw them", async () => {
  const m = new StrategyModel(() => flat(200, 100, Q), 3, () => 199 * Q + 1_000);
  const d = await m.decide(state(100, "flat"));
  expect(d.levels!.timeframe).toBe("15m");
  expect(d.levels!.short).toBeGreaterThan(100);
  expect(d.levels!.long).toBeLessThan(100);
  const warm = await new StrategyModel(() => flat(10, 100, Q), 3, () => 9 * Q).decide(state(100, "flat"));
  expect(warm.levels).toBeUndefined();
});
