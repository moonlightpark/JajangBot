import { expect, test } from "bun:test";
import type { Ohlc } from "../src/chart";
import { resolveEmaLen, resolveGaps, resolveModel, resolveShare, resolveStrategyExit } from "../src/config";
import { StrategyModel, type TradeState } from "../src/model";
import { closeSize } from "../src/plan";
import { addGap, emaSeries, swingLevel, MAGINGA, magingaChannel, magingaDecision, magingaLines, SCRIPT_RULES, trackEntries, withLiveBar, type StrategyRules } from "../src/strategy";

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
/** The script as written. Passed explicitly so the user's .env STRATEGY_* (Bun loads it in tests too) never leaks in. */
const SCRIPT = { params: MAGINGA, rules: SCRIPT_RULES };

test("StrategyModel decides every tick from the live price, at the strategy leverage", async () => {
  const bars = flat(200, 100, Q);
  const m = new StrategyModel(() => bars, 3, () => 199 * Q + 1_000, SCRIPT);
  const spike = await m.decide(state(102, "flat"));
  expect(spike).toMatchObject({ action: "sell", intent: "open", bias: "short", leverage: 3 });
  const calm = await m.decide(state(100, "flat"));
  expect(calm).toMatchObject({ action: "hold", intent: "hold" });
  const exit = await m.decide(state(102, "long"));
  expect(exit).toMatchObject({ action: "sell", intent: "close" });
});

test("StrategyModel uses STRATEGY_LEVERAGE as set, held to the coin max", async () => {
  const at = (lev: number) => new StrategyModel(() => flat(200, 100, Q), lev, () => 199 * Q + 1_000, SCRIPT).decide(state(102, "flat"));
  expect((await at(15)).leverage).toBe(15);
  expect((await at(7)).leverage).toBe(7);
  expect((await at(80)).leverage).toBe(50);
});

test("StrategyModel reports the channel lines so the chart can draw them", async () => {
  const m = new StrategyModel(() => flat(200, 100, Q), 3, () => 199 * Q + 1_000, SCRIPT);
  const d = await m.decide(state(100, "flat"));
  expect(d.levels!.timeframe).toBe("15m");
  expect(d.levels!.short).toBeGreaterThan(100);
  expect(d.levels!.long).toBeLessThan(100);
  const warm = await new StrategyModel(() => flat(10, 100, Q), 3, () => 9 * Q, SCRIPT).decide(state(100, "flat"));
  expect(warm.levels).toBeUndefined();
});

test("magingaChannel matches magingaLines on every prefix", () => {
  const bars = Array.from({ length: 140 }, (_, i) => {
    const px = 100 + Math.sin(i / 9) * 4;
    return { ts: i * Q, open: px, high: px * 1.003, low: px * 0.997, close: px };
  });
  const ch = magingaChannel(bars);
  expect(ch).toHaveLength(140 - 124);
  for (const n of [125, 131, 140]) {
    const l = magingaLines(bars.slice(0, n))!;
    const c = ch.find((x) => x.ts === bars[n - 1]!.ts)!;
    expect(c.long).toBeCloseTo(l.longLine, 9);
    expect(c.short).toBeCloseTo(l.shortLine, 9);
  }
  expect(magingaChannel(bars.slice(0, 100))).toEqual([]);
});

const withEntry = (mid: number, side: "long" | "short", entry: number): TradeState =>
  ({ ...state(mid, side), position: { side, leverage: null, entry } } as unknown as TradeState);
const variant = (rules: Partial<StrategyRules>, emaLen = 125) => ({ params: { ...MAGINGA, emaLen }, rules: { ...SCRIPT_RULES, ...rules } });
// Flat 15m bars at 100: short line ~101.82, long line ~98.18, middle ~100.
const NOW = 199 * Q + 1_000;

test("StrategyModel stop loss closes past the set percent, then waits for the signal to clear before re-entering", async () => {
  const m = new StrategyModel(() => flat(200, 100, Q), 15, () => NOW, variant({ stopPct: 0.05 }));
  expect(await m.decide(withEntry(99.7, "short", 95))).toMatchObject({ intent: "hold" }); // 4.9% against
  expect(await m.decide(withEntry(100, "short", 95))).toMatchObject({ intent: "close", bias: "short" }); // 5.3%
  expect(await m.decide(state(102, "flat"))).toMatchObject({ intent: "hold" }); // short signal, but just stopped
  expect(await m.decide(state(100, "flat"))).toMatchObject({ intent: "hold" }); // signal cleared
  expect(await m.decide(state(102, "flat"))).toMatchObject({ intent: "open", bias: "short" });
});

test("StrategyModel mid exit takes profit at the channel middle", async () => {
  const m = new StrategyModel(() => flat(200, 100, Q), 15, () => NOW, variant({ exit: "mid" }));
  expect(await m.decide(withEntry(99.9, "long", 98))).toMatchObject({ intent: "hold" });
  expect(await m.decide(withEntry(100.1, "long", 98))).toMatchObject({ intent: "close", bias: "long" });
  const script = new StrategyModel(() => flat(200, 100, Q), 15, () => NOW, SCRIPT);
  expect(await script.decide(withEntry(100.1, "long", 98))).toMatchObject({ intent: "hold" });
});

test("StrategyModel live take profit closes on the tick price at the far line, with bar close reading", async () => {
  const live = new StrategyModel(() => flat(200, 100, Q), 15, () => NOW, variant({ onBarClose: true, exitLive: true }));
  expect(await live.decide(withEntry(101, "long", 99))).toMatchObject({ intent: "hold" });
  expect(await live.decide(withEntry(101.9, "long", 99))).toMatchObject({ intent: "close", bias: "long" }); // short line ~101.82
  expect(await live.decide(withEntry(98.1, "short", 101))).toMatchObject({ intent: "close", bias: "short" }); // long line ~98.18
  const atClose = new StrategyModel(() => flat(200, 100, Q), 15, () => NOW, variant({ onBarClose: true }));
  expect(await atClose.decide(withEntry(101.9, "long", 99))).toMatchObject({ intent: "hold" }); // waits for the bar
});

test("StrategyModel onBarClose reads the last closed 15m bar, not the forming one", async () => {
  const bars = withLast(flat(200, 100, Q), { high: 102 }); // bar 199 spikes while forming
  const forming = new StrategyModel(() => bars, 15, () => NOW, variant({}));
  expect(await forming.decide(state(100, "flat"))).toMatchObject({ intent: "open", bias: "short" });
  const atClose = new StrategyModel(() => bars, 15, () => NOW, variant({ onBarClose: true }));
  expect(await atClose.decide(state(100, "flat"))).toMatchObject({ intent: "hold" });
  const closed = new StrategyModel(() => bars, 15, () => 200 * Q + 1_000, variant({ onBarClose: true }));
  expect(await closed.decide(state(100, "flat"))).toMatchObject({ intent: "open", bias: "short" });
});

test("StrategyModel EMA length comes from the variant", async () => {
  const short = await new StrategyModel(() => flat(150, 100, Q), 15, () => 149 * Q + 1_000, variant({}, 200)).decide(state(100, "flat"));
  expect(short.levels).toBeUndefined(); // 150 bars < 200: warming up
  const ok = await new StrategyModel(() => flat(250, 100, Q), 15, () => 249 * Q + 1_000, variant({}, 200)).decide(state(100, "flat"));
  expect(ok.levels).toBeDefined();
});

test("STRATEGY_* settings parse and reject bad values", () => {
  expect(resolveStrategyExit(undefined)).toBe("opposite");
  expect(resolveStrategyExit("MID")).toBe("mid");
  expect(() => resolveStrategyExit("half")).toThrow();
  expect(resolveEmaLen(undefined)).toBe(125);
  expect(resolveEmaLen("200")).toBe(200);
  expect(() => resolveEmaLen("1.5")).toThrow();
});

test("trackEntries counts a growing position as one more entry, and flat clears it", () => {
  const one = trackEntries(null, "short", 1, 10)!;
  expect(one).toEqual({ side: "short", count: 1, lastTs: 10, size: 1 });
  expect(trackEntries(one, "short", 1, 20)).toBe(one); // same size: no new entry
  expect(trackEntries(one, "short", 2, 30)).toEqual({ side: "short", count: 2, lastTs: 30, size: 2, prevTs: 10 });
  expect(trackEntries(one, "long", 1, 40)).toEqual({ side: "long", count: 1, lastTs: 40, size: 1 }); // flipped
  expect(trackEntries(one, "flat", 0, 50)).toBeNull();
});

/** A held position of `size` at `mid`, entry at 100. */
const held = (mid: number, side: "long" | "short", size: number): TradeState =>
  ({ ...state(mid, side), position: { side, leverage: null, entry: 100, size } } as unknown as TradeState);

test("StrategyModel adds up to twice on the same side, each 50 bars after the last entry", async () => {
  let now = NOW;
  const m = new StrategyModel(() => flat(200, 100, Q), 15, () => now, variant({ maxAdds: 2, addGapBars: [50] }));
  expect(await m.decide(state(102, "flat"))).toMatchObject({ intent: "open", bias: "short" }); // entry 1 signal
  expect(await m.decide(held(102, "short", 1))).toMatchObject({ intent: "hold" }); // filled; entry 2 waits 0/50
  now = NOW + 49 * Q;
  expect(await m.decide(held(102, "short", 1))).toMatchObject({ intent: "hold" }); // 49 bars
  now = NOW + 50 * Q;
  expect(await m.decide(held(100, "short", 1))).toMatchObject({ intent: "hold" }); // 50 bars, but no signal
  expect(await m.decide(held(102, "short", 1))).toMatchObject({ intent: "open", bias: "short" }); // entry 2
  expect(await m.decide(held(102, "short", 2))).toMatchObject({ intent: "hold" }); // filled; entry 3 waits
  now = NOW + 99 * Q;
  expect(await m.decide(held(102, "short", 2))).toMatchObject({ intent: "hold" }); // 49 bars since entry 2
  now = NOW + 100 * Q;
  expect(await m.decide(held(102, "short", 2))).toMatchObject({ intent: "open", bias: "short" }); // entry 3
  expect(await m.decide(held(102, "short", 3))).toMatchObject({ intent: "hold" });
  now = NOW + 200 * Q;
  expect(await m.decide(held(102, "short", 3))).toMatchObject({ intent: "hold" }); // 3 entries is the most
  expect(await m.decide(held(97, "short", 3))).toMatchObject({ intent: "close", bias: "short" }); // exit as before
  expect(await m.decide(state(102, "flat"))).toMatchObject({ intent: "open", bias: "short" }); // flat: a fresh first entry
});

test("StrategyModel uses each add's own gap: entry 3 waits 70 bars after entry 2", async () => {
  let now = NOW;
  const m = new StrategyModel(() => flat(200, 100, Q), 15, () => now, variant({ maxAdds: 2, addGapBars: [50, 70] }));
  await m.decide(held(102, "short", 1)); // entry 1 at NOW
  now = NOW + 50 * Q;
  expect(await m.decide(held(102, "short", 1))).toMatchObject({ intent: "open", bias: "short" }); // entry 2 after 50
  await m.decide(held(102, "short", 2)); // filled at NOW + 50 bars
  now = NOW + 119 * Q;
  expect(await m.decide(held(102, "short", 2))).toMatchObject({ intent: "hold" }); // 69 of 70 bars
  now = NOW + 120 * Q;
  expect(await m.decide(held(102, "short", 2))).toMatchObject({ intent: "open", bias: "short" }); // entry 3 after 70
});

test("StrategyModel carrying the backtest's open short adds entry 2 once 70 bars have passed since the backtest's entry", async () => {
  let now = NOW;
  const m = new StrategyModel(() => flat(200, 100, Q), 15, () => now, variant({ maxAdds: 2, addGapBars: [70] }));
  // The backtest's entry 1 was 69 bars before the bot started.
  m.carry({ side: "short", size: 0.0030000000000000005, entryPx: 101, feesUsd: 0.05, entryTs: NOW - 69 * Q, count: 1, lastTs: NOW - 69 * Q, firstPx: 101 });
  expect(await m.decide(held(102, "short", 0.003))).toMatchObject({ intent: "hold" }); // 69 of 70 bars
  now = NOW + Q;
  expect(await m.decide(held(102, "short", 0.003))).toMatchObject({ intent: "open", bias: "short" }); // entry 2, not entry 1
  await m.decide(held(102, "short", 0.006));
  now = NOW + 71 * Q;
  expect(await m.decide(held(102, "short", 0.006))).toMatchObject({ intent: "open", bias: "short" }); // entry 3
  await m.decide(held(102, "short", 0.009));
  now = NOW + 200 * Q;
  expect(await m.decide(held(102, "short", 0.009))).toMatchObject({ intent: "hold" }); // 3 entries is the most
});

test("STRATEGY_ADD_GAP_BARS takes one gap or one per add", () => {
  expect(resolveGaps("G", undefined, [50], 1, 10_000)).toEqual([50]);
  expect(resolveGaps("G", "60", [50], 1, 10_000)).toEqual([60]);
  expect(resolveGaps("G", "50, 70", [50], 1, 10_000)).toEqual([50, 70]);
  expect(() => resolveGaps("G", "50,,70", [50], 1, 10_000)).toThrow();
  expect(() => resolveGaps("G", "0", [50], 1, 10_000)).toThrow();
  expect(addGap([50, 70], 2)).toBe(50);
  expect(addGap([50, 70], 3)).toBe(70);
  expect(addGap([50, 70], 4)).toBe(70);
});

test("StrategyModel partial take profit: 70% once at the channel middle after the first entry, then no adds", async () => {
  let now = NOW;
  const m = new StrategyModel(() => flat(200, 100, Q), 15, () => now, variant({ partialTp: 0.7, maxAdds: 2, addGapBars: [50] }));
  expect(await m.decide(held(99.9, "long", 1))).toMatchObject({ intent: "hold" }); // under the middle (~100)
  const tp = await m.decide(held(100.05, "long", 1));
  expect(tp).toMatchObject({ intent: "close", bias: "long", closeFraction: 0.7 });
  expect(await m.decide(held(100.05, "long", 0.3))).toMatchObject({ intent: "hold" }); // trimmed: once only
  now = NOW + 60 * Q;
  expect(await m.decide(held(97, "long", 0.3))).toMatchObject({ intent: "hold" }); // long signal, but no add after a trim
  expect(await m.decide(held(102, "long", 0.3))).toMatchObject({ intent: "close", bias: "long" }); // rest at the short line
  expect((await m.decide(held(102, "long", 0.3))).closeFraction).toBeUndefined();
});

test("StrategyModel partial take profit is skipped once an add is in", async () => {
  let now = NOW;
  const m = new StrategyModel(() => flat(200, 100, Q), 15, () => now, variant({ partialTp: 0.7, maxAdds: 2, addGapBars: [50] }));
  await m.decide(held(98, "short", 1));
  now = NOW + 50 * Q;
  await m.decide(held(98, "short", 2)); // entry 2 filled
  expect(await m.decide(held(99.9, "short", 2))).toMatchObject({ intent: "hold" }); // short under the middle: no partial
});

test("closeSize floors the part to the step and takes it all when a part or the rest is under a step", () => {
  expect(closeSize(1, 0.7, 0.01)).toBe(0.7);
  expect(closeSize(0.392, 0.7, 0.001)).toBe(0.274);
  expect(closeSize(0.001, 0.7, 0.001)).toBe(0.001); // 0.0007 is under a step: all of it
  expect(closeSize(0.002, 0.7, 0.001)).toBe(0.001);
  expect(closeSize(0.5, undefined, 0.001)).toBe(0.5);
});

test("swingLevel takes the lowest low or highest high of the bars between two entries", () => {
  const bars = [0, 1, 2, 3, 4].map((i) => ({ ts: i * Q, open: 100, high: 101 + i, low: 99 - i, close: 100 }));
  expect(swingLevel(bars, "long", 1 * Q + 5, 3 * Q + 5, Q)).toBe(96); // bars 1..3: lows 98, 97, 96
  expect(swingLevel(bars, "short", 1 * Q, 2 * Q, Q)).toBe(103);
  expect(swingLevel(bars, "long", 9 * Q, 10 * Q, Q)).toBeNull();
});

test("StrategyModel swing stop: after entry 3, stops when the price breaks the low between entries 2 and 3", async () => {
  let now = NOW;
  // Flat bars at 100 (lows 99.9); entry 2's bar dips to 99 and entry 3's bar to 98.5.
  const bars = () => {
    const b = flat(400, 100, Q);
    const at = (ts: number, low: number) => { const i = b.findIndex((x) => x.ts === Math.floor(ts / Q) * Q); if (i >= 0) b[i] = { ...b[i]!, low }; };
    at(NOW + 70 * Q, 99);
    at(NOW + 140 * Q, 98.5);
    return b;
  };
  const m = new StrategyModel(bars, 15, () => now, variant({ swingStop: true, maxAdds: 2, addGapBars: [70] }));
  await m.decide(held(98, "long", 1));
  now = NOW + 70 * Q;
  await m.decide(held(98, "long", 2)); // entry 2
  expect(await m.decide(held(98.4, "long", 2))).toMatchObject({ intent: "hold" }); // only 2 entries: no swing stop yet
  now = NOW + 140 * Q;
  await m.decide(held(99, "long", 3)); // entry 3: level = lowest low from entry 2's bar to entry 3's = 98.5
  expect(await m.decide(held(98.6, "long", 3))).toMatchObject({ intent: "hold" });
  expect(await m.decide(held(98.4, "long", 3))).toMatchObject({ intent: "close", bias: "long" });
});

test("StrategyModel takes 2/3 at the first entry's price once all 3 entries are in", async () => {
  let now = NOW;
  const m = new StrategyModel(() => flat(400, 100, Q), 15, () => now, variant({ firstPriceTp: 2 / 3, maxAdds: 2, addGapBars: [70] }));
  const pos = (mid: number, size: number, entry: number) =>
    ({ ...state(mid, "short"), position: { side: "short", leverage: null, entry, size } } as unknown as TradeState);
  await m.decide(pos(102, 1, 102)); // entry 1 at 102
  expect(await m.decide(pos(101.9, 1, 102))).toMatchObject({ intent: "hold" }); // one entry: not this rule
  now = NOW + 70 * Q;
  await m.decide(pos(103, 2, 102.5)); // entry 2
  expect(await m.decide(pos(102, 2, 102.5))).toMatchObject({ intent: "hold" }); // two entries: not yet
  now = NOW + 140 * Q;
  await m.decide(pos(104, 3, 103)); // entry 3
  expect(await m.decide(pos(102.1, 3, 103))).toMatchObject({ intent: "hold" }); // above entry 1 (short)
  const tp = await m.decide(pos(102, 3, 103));
  expect(tp).toMatchObject({ intent: "close", bias: "short" });
  expect(tp.closeFraction).toBeCloseTo(2 / 3, 9);
  expect(await m.decide(pos(101.9, 1, 103))).toMatchObject({ intent: "hold" }); // trimmed: once only
});

test("STRATEGY_FIRST_PRICE_TP takes 2/3 or a percent", () => {
  expect(resolveShare("S", "2/3")).toBeCloseTo(2 / 3, 9);
  expect(resolveShare("S", "70")).toBeCloseTo(0.7, 9);
  expect(resolveShare("S", "")).toBeNull();
  expect(() => resolveShare("S", "3/2")).toThrow();
});

test("StrategyModel without STRATEGY_MAX_ADDS never adds, as in the script", async () => {
  const m = new StrategyModel(() => flat(200, 100, Q), 15, () => NOW + 500 * Q, SCRIPT);
  expect(await m.decide(held(102, "short", 1))).toMatchObject({ intent: "hold" });
  expect(await m.decide(held(97, "long", 1))).toMatchObject({ intent: "hold" });
});
