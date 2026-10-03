import type { Ohlc } from "./chart";
import type { Bias, Intent } from "./plan";

/**
 * "[GaYang] Maginga 15Ho - v5.4" (TradingView Pine v4), the parts that place orders.
 *
 *   emahigh = ema(high, 125), emalow = ema(low, 125)
 *   short_detect_line = emahigh * 1.01618
 *   long_detect_line  = emalow  * (1 - 0.01619)
 *   detect_short = high  > short_detect_line
 *   detect_long  = close < long_detect_line
 *
 *   long  and detect_short -> close long
 *   short and detect_long  -> close short
 *   flat  and detect_short -> enter short
 *   flat  and detect_long  -> enter long
 *
 * The script also computes Squeeze Momentum, CMF, DEMA, the 2nd lines (3.82%),
 * and stop/target prices, but none of them feed strategy.entry or strategy.close,
 * so they are left out. There is no stop loss in the original: a position only
 * closes when price reaches the opposite band.
 */
export const MAGINGA = {
  emaLen: 125,
  shortBand: 0.01618,
  longBand: 0.01619,
  /** Labels in the script say "Leverage x3". */
  leverage: 3,
} as const;

/** Pine `ema`: SMA of the first `len` values as the seed, then alpha = 2 / (len + 1). NaN until seeded. */
export function emaSeries(xs: number[], len: number): number[] {
  const out = new Array<number>(xs.length).fill(Number.NaN);
  if (len < 1 || xs.length < len) return out;
  let seed = 0;
  for (let i = 0; i < len; i++) seed += xs[i]!;
  let prev = seed / len;
  out[len - 1] = prev;
  const alpha = 2 / (len + 1);
  for (let i = len; i < xs.length; i++) {
    prev = alpha * xs[i]! + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export interface MagingaLines {
  emaHigh: number;
  emaLow: number;
  shortLine: number;
  longLine: number;
}

/** Channel lines on the last bar. Null until there are enough bars to seed the EMA. */
export function magingaLines(bars: Ohlc[], p = MAGINGA): MagingaLines | null {
  if (bars.length < p.emaLen) return null;
  const emaHigh = emaSeries(bars.map((b) => b.high), p.emaLen).at(-1)!;
  const emaLow = emaSeries(bars.map((b) => b.low), p.emaLen).at(-1)!;
  return {
    emaHigh,
    emaLow,
    shortLine: emaHigh * (1 + p.shortBand),
    longLine: emaLow * (1 - p.longBand),
  };
}

export interface MagingaCall {
  intent: Intent;
  bias: Bias;
  /** Why: which line was touched, or why it held. */
  reason: string;
  lines: MagingaLines | null;
}

/** One decision on the last bar (the forming bar when run every tick). */
export function magingaDecision(bars: Ohlc[], side: "long" | "short" | "flat", p = MAGINGA): MagingaCall {
  const lines = magingaLines(bars, p);
  const last = bars.at(-1);
  if (!lines || !last) return { intent: "hold", bias: "long", reason: `warming up (${bars.length}/${p.emaLen} bars)`, lines };
  const detectShort = last.high > lines.shortLine;
  const detectLong = last.close < lines.longLine;
  if (side === "short" && detectLong) return { intent: "close", bias: "short", reason: "close below long line, take short profit", lines };
  if (side === "long" && detectShort) return { intent: "close", bias: "long", reason: "high above short line, take long profit", lines };
  if (side === "flat" && detectShort && !detectLong) return { intent: "open", bias: "short", reason: "high above short line", lines };
  if (side === "flat" && detectLong && !detectShort) return { intent: "open", bias: "long", reason: "close below long line", lines };
  return { intent: "hold", bias: side === "short" ? "short" : "long", reason: "inside the channel", lines };
}

/**
 * Closed bars plus a forming bar that includes the live mid, so the strategy reads
 * the current price every tick (TradingView `calc_on_every_tick`).
 */
export function withLiveBar(bars: Ohlc[], mid: number, now: number, periodMs: number): Ohlc[] {
  if (!(mid > 0)) return bars;
  const start = Math.floor(now / periodMs) * periodMs;
  const last = bars.at(-1);
  if (last && last.ts === start) {
    return [...bars.slice(0, -1), { ...last, high: Math.max(last.high, mid), low: Math.min(last.low, mid), close: mid }];
  }
  return [...bars, { ts: start, open: last?.close ?? mid, high: mid, low: mid, close: mid }];
}
