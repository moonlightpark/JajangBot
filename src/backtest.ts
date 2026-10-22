import { snapToStep } from "./book";
import type { Ohlc } from "./chart";
import { closeSize, liveIntent } from "./plan";
import { firstPriceRestart, MAGINGA, rearm, strategyCall, type MagingaLines, type MagingaParams, type StrategyRules } from "./strategy";
import type { BacktestOpen, BacktestReport, BacktestTrade } from "./types";

export type { BacktestTrade };

export const MINUTE_MS = 60_000;
/** Written by `bun run backtest`, served by the bot at GET /backtest. */
export const BACKTEST_LATEST = "backtest-results/latest.json";

/**
 * Pine `ema` one value at a time: SMA of the first `len` values as the seed, then
 * alpha = 2 / (len + 1). `peek` is the value the next push would give, for the forming bar.
 */
export class EmaStep {
  private n = 0;
  private sum = 0;
  private v = Number.NaN;
  private readonly alpha: number;
  constructor(private len: number) {
    this.alpha = 2 / (len + 1);
  }
  /** The value after the last push. NaN until seeded. */
  get value(): number {
    return this.v;
  }
  peek(x: number): number {
    if (this.n + 1 < this.len) return Number.NaN;
    if (this.n + 1 === this.len) return (this.sum + x) / this.len;
    return this.alpha * x + (1 - this.alpha) * this.v;
  }
  push(x: number) {
    this.v = this.peek(x);
    this.n++;
    if (this.n <= this.len) this.sum += x;
  }
}

export interface BacktestOpts {
  /** First tick that may trade. Bars before it only warm up the EMA. */
  startTs: number;
  leverage: number;
  quoteUsd: number;
  qtyStep: number;
  minQty: number;
  minNotional: number;
  /** Fee rates as fractions, e.g. 0.0002 for 0.02%. */
  makerFee: number;
  takerFee: number;
  /** StrategyRules (src/strategy.ts). Left out, each is the script as written. */
  /** Stop loss as a fraction of entry (0.05 = 5%), checked at each tick's price like the live bot. */
  stopPct?: number | null;
  /** "opposite": close at the far line. "mid": close once the bar closes past the channel middle. */
  exit?: "opposite" | "mid";
  /** true: read the last closed 15m bar each tick, as the live bot does with STRATEGY_ON_BAR_CLOSE. */
  onBarClose?: boolean;
  /** true: take profit at the far line on the tick price, without waiting for a bar close. */
  exitLive?: boolean;
  /** Share (0.7 = 70%) taken once at the channel middle while only the first entry is in. */
  partialTp?: number | null;
  /** Stop at the low/high between the last two entries once the last entry is in. */
  swingStop?: boolean;
  /** Share taken at the first entry's price once every entry is in. */
  firstPriceTp?: number | null;
  /** Share taken after the re-entry, back at the first-price take profit's price. */
  retakeTp?: number | null;
  /** Adds (물타기) after the first entry, same side, each its `addGapBars` 15m bars after the last. 0: none. */
  maxAdds?: number;
  addGapBars?: number[];
}


export interface BacktestResult {
  ticks: number;
  trades: BacktestTrade[];
  pnlUsd: number;
  feesUsd: number;
  /** Largest drop of marked-to-market PnL from its running peak. */
  maxDrawdownUsd: number;
  /** Entry signals that ended (hold) before their post-only order filled. */
  missedEntries: number;
  /** Trades closed by the stop loss. After a stop, that side waits for price to leave the band before re-entering. */
  stops: number;
  firstTs: number | null;
  lastTs: number | null;
  /** The position still open at the end, with the strategy's entry state. */
  open: BacktestOpen | null;
}

type Pending = { side: "long" | "short"; price: number; size: number };

/** Net PnL (after fees) of each coin's closed trades. Trades still open at the end are left out. */
export function closedNetByCoin(report: Pick<BacktestReport, "tradesByCoin"> | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [coin, trades] of Object.entries(report?.tradesByCoin ?? {})) {
    out[coin] = trades.reduce((s, t) => (t.exitTs == null ? s : s + t.pnlUsd), 0);
  }
  return out;
}

/** The last `bun run backtest` run, or null when there is none or it does not parse. */
export async function readBacktestReport(path = BACKTEST_LATEST): Promise<BacktestReport | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const r = (await file.json()) as BacktestReport;
    return r && typeof r.tradesByCoin === "object" ? r : null;
  } catch {
    return null;
  }
}

/** Live `quoteSize`: QUOTE_USD of coin at `px`, never under the venue minimums. */
export function orderSize(px: number, o: Pick<BacktestOpts, "quoteUsd" | "qtyStep" | "minQty" | "minNotional">): number {
  if (!(px > 0)) return 0;
  const want = snapToStep(o.quoteUsd / px, o.qtyStep, "floor");
  const floor = Math.max(o.minQty, snapToStep(o.minNotional / px, o.qtyStep, "ceil"));
  return Math.max(want, floor);
}

/**
 * Replays the live strategy loop on 1m candles, one tick at the close of each minute.
 *
 * Each tick builds the forming 15m bar from the minutes so far (its high and low are
 * the real highs and lows, as on the live kline stream), reads the price at the close,
 * and asks the same `magingaRule` the live StrategyModel uses.
 *
 * With maxAdds, the side's own entry signal while it is held adds to the position (물타기)
 * once that add's addGapBars 15m bars have passed since the last entry; the entry price averages in.
 *
 * Orders follow the live bot: an entry rests post-only at the tick price and fills
 * only if the next minute trades through it (maker fee); a new tick requotes it, a
 * hold cancels it. An exit crosses at the tick price (taker fee). Spread, slippage,
 * funding, and liquidation are not modeled.
 */
export function runBacktest(minutes: Ohlc[], o: BacktestOpts, p: MagingaParams = MAGINGA): BacktestResult {
  const eHigh = new EmaStep(p.emaLen), eLow = new EmaStep(p.emaLen);
  let forming: Ohlc = { ts: -1, open: 0, high: 0, low: 0, close: 0 };
  let lastClosed: Ohlc | null = null;
  const rules: StrategyRules = {
    stopPct: o.stopPct ?? null,
    exit: o.exit ?? "opposite",
    onBarClose: o.onBarClose ?? false,
    exitLive: o.exitLive ?? false,
    partialTp: o.partialTp ?? null,
    swingStop: o.swingStop ?? false,
    firstPriceTp: o.firstPriceTp ?? null,
    retakeTp: o.retakeTp ?? null,
    maxAdds: o.maxAdds ?? 0,
    addGapBars: o.addGapBars ?? [50],
  };
  let pending: Pending | null = null;
  /** `round` is the entry number the strategy counted, which restarts after the first-price take profit. */
  type Entry = { ts: number; px: number; size: number; round?: number };
  /** entryPx is the average over `entries`. */
  type Pos = { side: "long" | "short"; entryTs: number; entryPx: number; size: number; fee: number; worst: number; entries: Entry[]; trimmed?: boolean;
    /** The entry number the strategy counts (entries.length until a first-price take profit restarts it). */
    count: number;
    /** The price the last first-price take profit closed at. */
    tpPx?: number;
    /** Lowest low (long) or highest high (short) since the last entry; `level` freezes it at the last entry. */
    ext: number; level?: number };
  let pos: Pos | null = null;
  // A trimmed position keeps its entries, so the rest still shows the size it opened with.
  const entriesOf = (p: Pos) => (p.entries.length > 1 || p.trimmed ? { entries: p.entries } : {});
  const trades: BacktestTrade[] = [];
  let realized = 0, fees = 0, peak = 0, maxDd = 0, ticks = 0, missed = 0, stops = 0;
  /** The side a stop just closed: no new entry that way until its signal clears. */
  let blocked: "long" | "short" | null = null;
  let firstTs: number | null = null, lastTs: number | null = null, lastPx = 0;

  /** Closes `size` of the position (all of it by default). A part is its own trade, with its share of the entry fees. */
  const close = (ts: number, px: number, size = pos!.size) => {
    const p = pos!;
    const part = size < p.size;
    const entryFee = p.fee * (size / p.size);
    const fee = px * size * o.takerFee;
    const gross = (p.side === "long" ? px - p.entryPx : p.entryPx - px) * size;
    realized += gross - fee;
    fees += fee;
    trades.push({
      side: p.side, entryTs: p.entryTs, entryPx: p.entryPx, ...entriesOf(p), exitTs: ts, exitPx: px, size,
      pnlUsd: gross - entryFee - fee, feesUsd: entryFee + fee, maxAdversePct: p.worst, ...(part ? { partial: true } : {}),
    });
    pos = part ? { ...p, size: p.size - size, fee: p.fee - entryFee, trimmed: true } : null;
  };

  for (const b of minutes) {
    // An entry posted last tick rests through this minute.
    if (pending) {
      const hit = pending.side === "long" ? b.low < pending.price : b.high > pending.price;
      if (hit) {
        const fee: number = pending.price * pending.size * o.makerFee;
        realized -= fee;
        fees += fee;
        const e: Entry = { ts: b.ts, px: pending.price, size: pending.size };
        const held = pos as Pos | null;
        const far = pending.side === "long" ? b.low : b.high;
        if (held && held.side === pending.side) {
          // An add: the position averages in. The last add fixes the swing stop at the extreme since the add before.
          const size = held.size + e.size;
          const count = held.count + 1;
          const entries = [...held.entries, count === held.entries.length + 1 ? e : { ...e, round: count }];
          const ext = held.side === "long" ? Math.min(held.ext, far) : Math.max(held.ext, far);
          const level = count >= 1 + rules.maxAdds ? ext : held.level;
          pos = { ...held, entryPx: (held.entryPx * held.size + e.px * e.size) / size, size, fee: held.fee + fee, entries, count, ext: far, level };
        } else {
          pos = { side: pending.side, entryTs: b.ts, entryPx: e.px, size: e.size, fee, worst: 0, entries: [e], count: 1, ext: far };
        }
        pending = null;
      }
    }
    if (pos) {
      const against = pos.side === "long" ? (pos.entryPx - b.low) / pos.entryPx : (b.high - pos.entryPx) / pos.entryPx;
      pos.worst = Math.max(pos.worst, against * 100);
      pos.ext = pos.side === "long" ? Math.min(pos.ext, b.low) : Math.max(pos.ext, b.high);
    }

    const period = Math.floor(b.ts / p.periodMs) * p.periodMs;
    if (forming.ts === period) {
      forming.high = Math.max(forming.high, b.high);
      forming.low = Math.min(forming.low, b.low);
      forming.close = b.close;
    } else {
      // The previous 15m bar just closed: it joins the EMA. ts -1 is the empty start.
      if (forming.ts >= 0) {
        eHigh.push(forming.high);
        eLow.push(forming.low);
        lastClosed = forming;
      }
      forming = { ts: period, open: b.open, high: b.high, low: b.low, close: b.close };
    }

    const tickTs = b.ts + MINUTE_MS;
    lastPx = b.close;
    if (tickTs <= o.startTs) continue;
    ticks++;
    firstTs ??= tickTs;
    lastTs = tickTs;

    // Live reads the forming bar, or with onBarClose the last closed one. At a 15m boundary
    // the forming bar has just closed, so both read it.
    const useForming = !rules.onBarClose || tickTs % p.periodMs === 0;
    const emaHigh = useForming ? eHigh.peek(forming.high) : eHigh.value;
    const emaLow = useForming ? eLow.peek(forming.low) : eLow.value;
    const last = useForming ? forming : lastClosed;
    const side = pos ? pos.side : "flat";
    let intent: "open" | "close" | "hold" = "hold";
    let bias: "long" | "short" = "long";
    let fraction: number | undefined;
    if (last && Number.isFinite(emaHigh) && Number.isFinite(emaLow)) {
      const lines: MagingaLines = { emaHigh, emaLow, shortLine: emaHigh * (1 + p.shortBand), longLine: emaLow * (1 - p.longBand) };
      const entries = pos
        ? { side: pos.side, count: pos.count, lastTs: pos.entries.at(-1)!.ts, size: pos.size, trimmed: pos.trimmed, level: pos.level, firstPx: pos.entries[0]!.px, tpPx: pos.tpPx }
        : null;
      let call = strategyCall(lines, last, side, b.close, pos ? pos.entryPx : null, rules, { entries, now: tickTs, periodMs: p.periodMs });
      if (call.stopped && pos) {
        blocked = pos.side;
        stops++;
      }
      ({ call, blocked } = rearm(blocked, !pos, call));
      intent = liveIntent(side, call.intent);
      bias = call.bias;
      fraction = call.closeFraction;
    }

    if (intent === "open") {
      // Requote at the new price, like the live cancel-and-replace.
      const size = orderSize(b.close, o);
      pending = size > 0 ? { side: bias, price: b.close, size } : null;
    } else {
      if (pending) missed++;
      pending = null;
      if (intent === "close" && pos) {
        close(tickTs, b.close, closeSize(pos.size, fraction, o.qtyStep));
        // After the first-price take profit or the retake the rest counts as entry 1 again, as live.
        const held = pos as Pos | null;
        if (held?.trimmed) {
          const log = { side: held.side, count: held.count, lastTs: 0, size: held.size, trimmed: true, tpPx: held.tpPx };
          const next = firstPriceRestart(log, rules, b.close);
          if (next !== log) pos = { ...held, count: 1, trimmed: false, level: undefined, tpPx: next!.tpPx };
        }
      }
    }

    const unrealized = pos ? (pos.side === "long" ? b.close - pos.entryPx : pos.entryPx - b.close) * pos.size : 0;
    const equity = realized + unrealized;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  if (pos) {
    const gross = (pos.side === "long" ? lastPx - pos.entryPx : pos.entryPx - lastPx) * pos.size;
    realized += gross;
    trades.push({
      side: pos.side, entryTs: pos.entryTs, entryPx: pos.entryPx, ...entriesOf(pos), exitTs: null, exitPx: lastPx, size: pos.size,
      pnlUsd: gross - pos.fee, feesUsd: pos.fee, maxAdversePct: pos.worst,
    });
  }
  const held = pos as Pos | null;
  const open: BacktestOpen | null = held && {
    side: held.side, size: held.size, entryPx: held.entryPx, feesUsd: held.fee, entryTs: held.entryTs,
    count: held.count, lastTs: held.entries.at(-1)!.ts,
    ...(held.count >= 2 && held.entries.length >= 2 ? { prevTs: held.entries.at(-2)!.ts } : {}),
    ...(held.trimmed ? { trimmed: true } : {}),
    ...(held.level != null ? { level: held.level } : {}),
    firstPx: held.entries[0]!.px,
    ...(held.tpPx != null ? { tpPx: held.tpPx } : {}),
  };
  return { ticks, trades, pnlUsd: realized, feesUsd: fees, maxDrawdownUsd: maxDd, missedEntries: missed, stops, firstTs, lastTs, open };
}
