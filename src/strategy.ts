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
  /** The strategy runs on 15m candles only. Other timeframes are not used. */
  timeframe: "15m",
  periodMs: 15 * 60_000,
  emaLen: 125,
  shortBand: 0.01618,
  longBand: 0.01619,
  /** Labels in the script say "Leverage x3". */
  leverage: 3,
} as const;

/** The knobs of the channel. The live strategy uses MAGINGA; the backtest sweep tries others. */
export interface MagingaParams {
  timeframe: string;
  periodMs: number;
  emaLen: number;
  shortBand: number;
  longBand: number;
  leverage: number;
}

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
export function magingaLines(bars: Ohlc[], p: MagingaParams = MAGINGA): MagingaLines | null {
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

/**
 * The channel at the close of every bar, oldest first, from the bar where the EMA is
 * seeded. Same values `magingaLines` gives on each prefix, in one pass.
 */
export function magingaChannel(bars: Ohlc[], p: MagingaParams = MAGINGA): { ts: number; long: number; short: number }[] {
  const highs = emaSeries(bars.map((b) => b.high), p.emaLen);
  const lows = emaSeries(bars.map((b) => b.low), p.emaLen);
  const out: { ts: number; long: number; short: number }[] = [];
  for (let i = p.emaLen - 1; i < bars.length; i++) {
    out.push({ ts: bars[i]!.ts, long: lows[i]! * (1 - p.longBand), short: highs[i]! * (1 + p.shortBand) });
  }
  return out;
}

export interface MagingaCall {
  intent: Intent;
  bias: Bias;
  /** Why: which line was touched, or why it held. */
  reason: string;
  lines: MagingaLines | null;
}

/** One decision on the last bar (the forming bar when run every tick). */
export function magingaDecision(bars: Ohlc[], side: "long" | "short" | "flat", p: MagingaParams = MAGINGA): MagingaCall {
  const lines = magingaLines(bars, p);
  const last = bars.at(-1);
  if (!lines || !last) return { intent: "hold", bias: "long", reason: `warming up (${bars.length}/${p.emaLen} bars)`, lines };
  return magingaRule(lines, last, side);
}

/** The order rules against lines already computed. The backtest calls this too, so both share one rule set. */
export function magingaRule(lines: MagingaLines, last: Ohlc, side: "long" | "short" | "flat"): MagingaCall {
  const detectShort = last.high > lines.shortLine;
  const detectLong = last.close < lines.longLine;
  if (side === "short" && detectLong) return { intent: "close", bias: "short", reason: "close below long line, take short profit", lines };
  if (side === "long" && detectShort) return { intent: "close", bias: "long", reason: "high above short line, take long profit", lines };
  if (side === "flat" && detectShort && !detectLong) return { intent: "open", bias: "short", reason: "high above short line", lines };
  if (side === "flat" && detectLong && !detectShort) return { intent: "open", bias: "long", reason: "close below long line", lines };
  return { intent: "hold", bias: side === "short" ? "short" : "long", reason: "inside the channel", lines };
}

/** Changes on top of the script's rules. Defaults (none, "opposite", false) are the script as written. */
export interface StrategyRules {
  /** Close once price is this fraction against the entry (0.05 = 5%). null: no stop, as in the script. */
  stopPct: number | null;
  /** "opposite": close at the far line (script). "mid": close once the bar closes past the channel middle. */
  exit: "opposite" | "mid";
  /** true: read the last closed 15m bar, as TradingView does by default. false: the forming bar every tick. */
  onBarClose: boolean;
}

export const SCRIPT_RULES: StrategyRules = { stopPct: null, exit: "opposite", onBarClose: false };

/**
 * The full call, live and in the backtest: stop loss first, then the script's lines,
 * then the channel-middle exit. `price` is the price this tick; `last` is the bar the
 * lines are read on (forming, or the last closed one with onBarClose).
 */
export function strategyCall(
  lines: MagingaLines,
  last: Ohlc,
  side: "long" | "short" | "flat",
  price: number,
  entry: number | null,
  rules: StrategyRules,
): MagingaCall & { stopped?: boolean } {
  if (side !== "flat" && rules.stopPct && entry && entry > 0) {
    const hit = side === "long" ? price <= entry * (1 - rules.stopPct) : price >= entry * (1 + rules.stopPct);
    if (hit) return { intent: "close", bias: side, reason: `stop loss ${+(rules.stopPct * 100).toFixed(2)}%`, lines, stopped: true };
  }
  const call = magingaRule(lines, last, side);
  if (rules.exit === "mid" && side !== "flat" && call.intent !== "close") {
    const mid = (lines.emaHigh + lines.emaLow) / 2;
    if (side === "long" ? last.close >= mid : last.close <= mid) {
      return { intent: "close", bias: side, reason: `channel middle, take ${side} profit`, lines };
    }
  }
  return call;
}

/**
 * After a stop, that side does not re-enter until its signal has cleared once, so a
 * stop inside a strong move is not followed by the same entry a minute later.
 */
export function rearm(blocked: "long" | "short" | null, flat: boolean, call: MagingaCall): { call: MagingaCall; blocked: "long" | "short" | null } {
  if (!blocked || !flat) return { call, blocked };
  if (call.intent === "open" && call.bias === blocked) {
    return { call: { ...call, intent: "hold", reason: `waiting after stop, ${call.reason}` }, blocked };
  }
  return { call, blocked: null };
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

/** Only the bars that have closed by `now`. The live feed also carries the forming one. */
export function closedBars(bars: Ohlc[], now: number, periodMs: number): Ohlc[] {
  let n = bars.length;
  while (n > 0 && bars[n - 1]!.ts + periodMs > now) n--;
  return n === bars.length ? bars : bars.slice(0, n);
}
