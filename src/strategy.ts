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
  /** A close of only this share of the position (0.7 = 70%). Left out: the whole position. */
  closeFraction?: number;
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
  /**
   * true: take profit at the far line on this tick's price, without waiting for a bar close
   * (long: price at or above the short line, short: price at or below the long line).
   * The bar-based exits still apply.
   */
  exitLive: boolean;
  /**
   * Share of the position (0.7 = 70%) to take profit once, when the tick price reaches the
   * channel middle while only the first entry is in. The rest exits by the other rules, and
   * no add goes in after it. null: off.
   */
  partialTp: number | null;
  /**
   * true: once the position has its last entry (1 + maxAdds), stop out when the tick price
   * breaks the extreme between the entry before it and that entry (long: the lowest low,
   * short: the highest high). Runs alongside stopPct; set stopPct to null to use only this.
   */
  swingStop: boolean;
  /**
   * Share of the position (2/3) to take profit when the position has its last entry
   * (1 + maxAdds) and the tick price gets back to the first entry's price. The rest then
   * counts as entry 1 again (`firstPriceRestart`), so the next entry signal is entry 2 and
   * the cycle can repeat against the same first entry price. null: off.
   */
  firstPriceTp: number | null;
  /**
   * After the firstPriceTp restart, once the re-entry (entry 2) is in: share (0.5) to take
   * when the tick price gets back to the price that take profit closed at. The rest counts
   * as entry 1 again, like after firstPriceTp. null: off.
   */
  retakeTp: number | null;
  /** Extra entries (물타기) on the same side while a position is open. 0: none, as in the script. */
  maxAdds: number;
  /**
   * Bars (of the strategy timeframe) after the last entry before the next add may go in, one
   * per add: [50, 70] means entry 2 waits 50 bars after entry 1, entry 3 waits 70 after entry 2.
   * The last value repeats for later adds.
   */
  addGapBars: number[];
}

export const SCRIPT_RULES: StrategyRules = { stopPct: null, exit: "opposite", onBarClose: false, exitLive: false, partialTp: null, swingStop: false, firstPriceTp: null, retakeTp: null, maxAdds: 0, addGapBars: [50] };

/** Entries into the open position: how many filled, and when the last one did. */
export interface EntryLog {
  side: "long" | "short";
  count: number;
  lastTs: number;
  /** Position size after the last fill, so a bigger size reads as a new entry. */
  size: number;
  /** The position has shrunk since it opened: the partial take profit is done. */
  trimmed?: boolean;
  /** When the entry before the last one filled. */
  prevTs?: number;
  /** swingStop: the extreme between the last two entries, set once by the caller. */
  level?: number;
  /** firstPriceTp: the first entry's fill price, set once by the caller. */
  firstPx?: number;
  /** retakeTp: the price the last firstPriceTp take profit closed at. */
  tpPx?: number;
}

/**
 * Updates the log from the position each tick. Flat clears it. A position that grows on
 * the same side is one more entry, stamped `now`. A position found already open (say after
 * a restart) counts as the first entry from `now`, so no add goes in early. A position
 * that shrinks on the same side has been partly closed (`trimmed`).
 */
export function trackEntries(log: EntryLog | null, side: "long" | "short" | "flat", size: number, now: number): EntryLog | null {
  if (side === "flat" || !(size > 0)) return null;
  if (!log || log.side !== side) return { side, count: 1, lastTs: now, size };
  if (size > log.size * (1 + 1e-9)) {
    return {
      side, count: log.count + 1, lastTs: now, size, prevTs: log.lastTs,
      ...(log.firstPx != null ? { firstPx: log.firstPx } : {}),
      ...(log.tpPx != null ? { tpPx: log.tpPx } : {}),
    };
  }
  return size < log.size * (1 - 1e-9) ? { ...log, size, trimmed: true } : log;
}

/**
 * After the take profit at the first entry price (all entries in), or the retake after the
 * re-entry (entry 2 or more, `tpPx` known), the rest counts as entry 1: adds open again
 * (the next one is entry 2), the swing level is cleared, and the first entry price stays.
 * `px` is the price that take profit closed at; the first-price one records it as `tpPx`
 * for the retake. Any other log comes back as it was. The partial take profit at the middle
 * needs a single entry, so it never matches here.
 */
export function firstPriceRestart(log: EntryLog | null, rules: StrategyRules, px?: number): EntryLog | null {
  if (!log || !log.trimmed) return log;
  const first = !!rules.firstPriceTp && log.count >= 1 + rules.maxAdds;
  const retake = !first && !!rules.retakeTp && log.tpPx != null && log.count >= 2;
  if (!first && !retake) return log;
  const { trimmed: _t, level: _l, prevTs: _p, ...rest } = log;
  const tpPx = first && px && px > 0 ? px : log.tpPx;
  return { ...rest, count: 1, ...(tpPx != null ? { tpPx } : {}) };
}

/** Bars entry `n` (2 or more) waits after the entry before it. */
export function addGap(gaps: number[], n: number): number {
  return gaps[Math.min(n - 2, gaps.length - 1)] ?? 50;
}

/**
 * The swing stop level: the lowest low (long) or highest high (short) of the bars from the
 * one holding `fromTs` to the one holding `toTs`. Null when no bar is in that span.
 */
export function swingLevel(bars: Ohlc[], side: "long" | "short", fromTs: number, toTs: number, periodMs: number): number | null {
  const from = Math.floor(fromTs / periodMs) * periodMs;
  const to = Math.floor(toTs / periodMs) * periodMs;
  let level: number | null = null;
  for (const b of bars) {
    if (b.ts < from || b.ts > to) continue;
    const v = side === "long" ? b.low : b.high;
    level = level == null ? v : side === "long" ? Math.min(level, v) : Math.max(level, v);
  }
  return level;
}

/** Whole strategy bars from `fromTs` to `now`, counted on bar boundaries. */
export function barsBetween(fromTs: number, now: number, periodMs: number): number {
  return Math.floor(now / periodMs) - Math.floor(fromTs / periodMs);
}

/**
 * The full call, live and in the backtest: stop loss first (percent, then the swing stop
 * once the last entry is in), then the live far-line exit,
 * then the take profit at the first entry's price (after the last entry), then the retake
 * at that take profit's price (after the re-entry), then the partial
 * take profit at the channel middle, then the script's lines,
 * then the channel-middle exit, then adds. `price` is the price this tick; `last` is the
 * bar the lines are read on (forming, or the last closed one with onBarClose). `entry` is
 * the average entry. `entries` and `now` gate adds: with `maxAdds`, the side's own entry
 * signal while that side is held opens again once that entry's `addGapBars` bars have
 * passed since the last entry, up to 1 + maxAdds entries in all.
 */
export function strategyCall(
  lines: MagingaLines,
  last: Ohlc,
  side: "long" | "short" | "flat",
  price: number,
  entry: number | null,
  rules: StrategyRules,
  scale?: { entries: EntryLog | null; now: number; periodMs: number },
): MagingaCall & { stopped?: boolean } {
  if (side !== "flat" && rules.stopPct && entry && entry > 0) {
    const hit = side === "long" ? price <= entry * (1 - rules.stopPct) : price >= entry * (1 + rules.stopPct);
    if (hit) return { intent: "close", bias: side, reason: `stop loss ${+(rules.stopPct * 100).toFixed(2)}%`, lines, stopped: true };
  }
  const log = scale?.entries;
  if (rules.swingStop && side !== "flat" && price > 0 && log && log.count >= 1 + rules.maxAdds && log.level != null) {
    const hit = side === "long" ? price < log.level : price > log.level;
    if (hit) return { intent: "close", bias: side, reason: `swing stop, ${side === "long" ? "below low" : "above high"} ${log.level} between entries ${log.count - 1} and ${log.count}`, lines, stopped: true };
  }
  if (rules.exitLive && side !== "flat" && price > 0) {
    if (side === "long" && price >= lines.shortLine) return { intent: "close", bias: "long", reason: "price at short line, take long profit now", lines };
    if (side === "short" && price <= lines.longLine) return { intent: "close", bias: "short", reason: "price at long line, take short profit now", lines };
  }
  const trimmed = scale?.entries?.trimmed === true;
  if (rules.firstPriceTp && side !== "flat" && price > 0 && !trimmed && log && log.count >= 1 + rules.maxAdds && log.firstPx) {
    if (side === "long" ? price >= log.firstPx : price <= log.firstPx) {
      const pct = +(rules.firstPriceTp * 100).toFixed(2);
      return { intent: "close", bias: side, reason: `back to entry 1 price ${log.firstPx}, take ${pct}% of ${side}`, lines, closeFraction: rules.firstPriceTp };
    }
  }
  if (rules.retakeTp && side !== "flat" && price > 0 && !trimmed && log && log.tpPx && log.count >= 2 && log.count < 1 + rules.maxAdds) {
    if (side === "long" ? price >= log.tpPx : price <= log.tpPx) {
      const pct = +(rules.retakeTp * 100).toFixed(2);
      return { intent: "close", bias: side, reason: `back to take profit price ${log.tpPx} after re-entry, take ${pct}% of ${side}`, lines, closeFraction: rules.retakeTp };
    }
  }
  if (rules.partialTp && side !== "flat" && price > 0 && !trimmed && (scale?.entries?.count ?? 1) === 1 && log?.tpPx == null) {
    const mid = (lines.emaHigh + lines.emaLow) / 2;
    if (side === "long" ? price >= mid : price <= mid) {
      const pct = +(rules.partialTp * 100).toFixed(2);
      return { intent: "close", bias: side, reason: `price at channel middle, take ${pct}% of ${side}`, lines, closeFraction: rules.partialTp };
    }
  }
  const call = magingaRule(lines, last, side);
  if (rules.exit === "mid" && side !== "flat" && call.intent !== "close") {
    const mid = (lines.emaHigh + lines.emaLow) / 2;
    if (side === "long" ? last.close >= mid : last.close <= mid) {
      return { intent: "close", bias: side, reason: `channel middle, take ${side} profit`, lines };
    }
  }
  if (side !== "flat" && call.intent === "hold" && rules.maxAdds > 0 && scale && !trimmed) {
    const again = side === "long" ? last.close < lines.longLine : last.high > lines.shortLine;
    if (again) {
      const n = scale.entries?.count ?? 1;
      const next = n + 1;
      if (n >= 1 + rules.maxAdds) return { ...call, reason: `${side} signal, ${n} entries already (max ${1 + rules.maxAdds})` };
      const since = scale.entries ? barsBetween(scale.entries.lastTs, scale.now, scale.periodMs) : 0;
      const gap = addGap(rules.addGapBars, next);
      if (since < gap) return { ...call, reason: `${side} signal, entry ${next} waits ${since}/${gap} bars` };
      return { intent: "open", bias: side, reason: `entry ${next} of ${1 + rules.maxAdds}, ${side} signal after ${since} bars`, lines };
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
