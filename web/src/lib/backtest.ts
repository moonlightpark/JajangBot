import type { BacktestReport, BacktestTrade } from "./bot-types";
import type { ClosedLot } from "./fills";
import { fmtDateTime, fmtPrice } from "./format";
import { asUtcSec, barMs, type BarSize } from "./ohlc";

/** A simulated trade on the chart. Kept apart from FillMark so it never reads as a real fill. */
export type BacktestMark = {
  time: number;
  kind: "entry" | "exit";
  side: "long" | "short";
  text: string;
  /** Exit marks only: true when the trade made money after fees. */
  win?: boolean;
  trade: BacktestTrade;
};

const money = (x: number) => `${x < 0 ? "-" : "+"}$${Math.abs(x).toFixed(2)}`;
const pct = (x: number) => `${x < 0 ? "-" : "+"}${Math.abs(x).toFixed(1)}%`;
const sideWord = (s: "long" | "short") => (s === "long" ? "Long" : "Short");

/** Coin size without float noise: 0.0010000001 -> "0.001". */
export function fmtSize(n: number): string {
  return String(Number(n.toPrecision(6)));
}

/** PnL after fees as a share of the margin put up (notional over leverage). */
export function roePct(t: BacktestTrade, leverage: number): number {
  const margin = (t.entryPx * t.size) / Math.max(1, leverage);
  return margin > 0 ? (t.pnlUsd / margin) * 100 : 0;
}

/** "1d 20h", "3h 15m", "45m" */
export function fmtHeld(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${mm}m`;
  return `${mm}m`;
}

/**
 * Entry and exit marks for one coin's backtest trades, bucketed to the view's bar.
 * Entries say side and size, exits say PnL after fees.
 * Marks whose bar is not on the chart are dropped (the 1m view only covers recent hours).
 */
export function backtestMarks(trades: BacktestTrade[], bar: BarSize, candleTimes: ReadonlySet<number>): BacktestMark[] {
  const interval = barMs(bar);
  const at = (ts: number) => asUtcSec(Math.floor(ts / interval) * interval);
  const out: BacktestMark[] = [];
  for (const t of trades) {
    const entry = at(t.entryTs);
    if (candleTimes.has(entry)) {
      const open = t.exitTs == null ? " open" : "";
      out.push({ time: entry, kind: "entry", side: t.side, text: `BT ${sideWord(t.side)} ${fmtSize(t.size)}${open}`, trade: t });
    }
    if (t.exitTs == null) continue;
    const exit = at(t.exitTs);
    if (candleTimes.has(exit)) {
      out.push({ time: exit, kind: "exit", side: t.side, text: `BT ${money(t.pnlUsd)}`, win: t.pnlUsd > 0, trade: t });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** One line of the hover card: label and value, with an optional tone for color. */
export type DetailRow = { label: string; value: string; tone?: "win" | "loss" | "long" | "short" };

/** Hover card for one backtest trade. Times use `fmtTime` (the chart clock), local time by default. */
export function backtestDetail(
  t: BacktestTrade,
  coin: string,
  leverage: number,
  fmtTime: (ms: number | null) => string = fmtDateTime,
): { title: string; side: "long" | "short"; rows: DetailRow[] } {
  const lev = Math.max(1, leverage);
  const rows: DetailRow[] = [
    { label: "Size", value: `${fmtSize(t.size)} ${coin} ${lev}x`, tone: t.side },
    { label: "Entry", value: `${fmtTime(t.entryTs)}  ${fmtPrice(t.entryPx)}` },
  ];
  const tone = t.pnlUsd > 0 ? "win" : t.pnlUsd < 0 ? "loss" : undefined;
  const pnl = `${money(t.pnlUsd)}  ROE ${pct(roePct(t, lev))}`;
  if (t.exitTs == null) {
    rows.push({ label: "Exit", value: `open, marked at ${fmtPrice(t.exitPx)}` });
    rows.push({ label: "PnL", value: `${pnl} (unrealized)`, tone });
  } else {
    rows.push({ label: "Exit", value: `${fmtTime(t.exitTs)}  ${fmtPrice(t.exitPx)}` });
    rows.push({ label: "Held", value: fmtHeld(t.exitTs - t.entryTs) });
    rows.push({ label: "PnL", value: pnl, tone });
  }
  rows.push({ label: "Fees", value: `$${t.feesUsd.toFixed(2)} (in PnL)` });
  rows.push({ label: "Max adverse", value: `${t.maxAdversePct.toFixed(2)}%` });
  return { title: `BT ${sideWord(t.side)} ${coin}`, side: t.side, rows };
}

/** A closed backtest trade as a History row. PnL is before fees, like the bot's own lots. */
export type BacktestLot = ClosedLot & { coin: string };

/** Closed backtest trades for these coins. Trades still open at the end of the run are left out. */
export function backtestLots(report: BacktestReport | null, coins: string[]): BacktestLot[] {
  if (!report) return [];
  const out: BacktestLot[] = [];
  for (const coin of coins) {
    for (const t of report.tradesByCoin[coin] ?? []) {
      if (t.exitTs == null) continue;
      out.push({
        key: `bt|${t.side}|${t.entryTs}|${t.exitTs}`,
        coin,
        ts: t.exitTs,
        openedTs: t.entryTs,
        side: t.side,
        size: t.size,
        entry: t.entryPx,
        exit: t.exitPx,
        pnl: t.pnlUsd + t.feesUsd,
        fee: t.feesUsd,
      });
    }
  }
  return out;
}

/** Count, wins, and PnL after fees of the lots. */
export function lotSummary(lots: ClosedLot[]): { trades: number; wins: number; netUsd: number } {
  let wins = 0, netUsd = 0;
  for (const l of lots) {
    const net = l.pnl - l.fee;
    netUsd += net;
    if (net > 0) wins++;
  }
  return { trades: lots.length, wins, netUsd };
}

export function parseBacktest(raw: unknown): BacktestReport | null {
  const r = raw as Partial<BacktestReport> | null;
  if (!r || typeof r !== "object" || !r.tradesByCoin || typeof r.tradesByCoin !== "object") return null;
  return {
    from: Number(r.from) || 0,
    to: Number(r.to) || 0,
    ranAt: Number(r.ranAt) || 0,
    quoteUsd: Number(r.quoteUsd) || 0,
    leverageByCoin: r.leverageByCoin ?? {},
    tradesByCoin: r.tradesByCoin,
  };
}
