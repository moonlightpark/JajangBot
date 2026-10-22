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
const sideWord = (s: "long" | "short") => (s === "long" ? "롱" : "숏");

/** Coin size without float noise: 0.0010000001 -> "0.001". */
export function fmtSize(n: number): string {
  return String(Number(n.toPrecision(6)));
}

/** PnL after fees as a share of the margin put up (notional over leverage). */
export function roePct(t: BacktestTrade, leverage: number): number {
  const margin = (t.entryPx * t.size) / Math.max(1, leverage);
  return margin > 0 ? (t.pnlUsd / margin) * 100 : 0;
}

/** "1일 20시간", "3시간 15분", "45분" */
export function fmtHeld(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d) return `${d}일 ${h}시간`;
  if (h) return `${h}시간 ${mm}분`;
  return `${mm}분`;
}

/**
 * Entry and exit marks for one coin's backtest trades, bucketed to the view's bar.
 * Entries say side and size (adds also their round, "2차"), exits say PnL after fees.
 * Marks whose bar is not on the chart are dropped (the 1m view only covers recent hours).
 */
export function backtestMarks(trades: BacktestTrade[], bar: BarSize, candleTimes: ReadonlySet<number>): BacktestMark[] {
  const interval = barMs(bar);
  const at = (ts: number) => asUtcSec(Math.floor(ts / interval) * interval);
  const out: BacktestMark[] = [];
  for (const t of trades) {
    const open = t.exitTs == null ? " 보유중" : "";
    // A partial take profit shares its entries with the trade that holds the rest; mark them once.
    if (t.partial) {
      // no entry marks
    } else if (t.entries?.length) {
      t.entries.forEach((e, i) => {
        const time = at(e.ts);
        if (!candleTimes.has(time)) return;
        const n = e.round ?? i + 1;
        const round = n === 1 ? "" : ` ${n}차`;
        out.push({ time, kind: "entry", side: t.side, text: `BT ${sideWord(t.side)}${round} ${fmtSize(e.size)}${open}`, trade: t });
      });
    } else {
      const entry = at(t.entryTs);
      if (candleTimes.has(entry)) {
        out.push({ time: entry, kind: "entry", side: t.side, text: `BT ${sideWord(t.side)} ${fmtSize(t.size)}${open}`, trade: t });
      }
    }
    if (t.exitTs == null) continue;
    const exit = at(t.exitTs);
    if (candleTimes.has(exit)) {
      out.push({ time: exit, kind: "exit", side: t.side, text: `BT ${t.partial ? "부분 " : ""}${money(t.pnlUsd)}`, win: t.pnlUsd > 0, trade: t });
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
  const rows: DetailRow[] = [{ label: "수량", value: `${fmtSize(t.size)} ${coin} ${lev}x`, tone: t.side }];
  if (t.entries && t.entries.length > 1) {
    // A re-entry after the first-price take profit shows its round again ("2차 재진입").
    t.entries.forEach((e, i) => rows.push({ label: e.round != null ? `${e.round}차 재진입` : `${i + 1}차 진입`, value: `${fmtTime(e.ts)}  ${fmtPrice(e.px)}` }));
    rows.push({ label: "평균가", value: fmtPrice(t.entryPx) });
  } else {
    rows.push({ label: "진입", value: `${fmtTime(t.entryTs)}  ${fmtPrice(t.entryPx)}` });
  }
  const tone = t.pnlUsd > 0 ? "win" : t.pnlUsd < 0 ? "loss" : undefined;
  const pnl = `${money(t.pnlUsd)}  수익률 ${pct(roePct(t, lev))}`;
  if (t.exitTs == null) {
    rows.push({ label: "청산", value: `미청산, 현재가 ${fmtPrice(t.exitPx)}` });
    rows.push({ label: "손익", value: `${pnl} (평가)`, tone });
  } else {
    rows.push({ label: t.partial ? "부분 익절" : "청산", value: `${fmtTime(t.exitTs)}  ${fmtPrice(t.exitPx)}` });
    rows.push({ label: "보유", value: fmtHeld(t.exitTs - t.entryTs) });
    rows.push({ label: "손익", value: pnl, tone });
  }
  rows.push({ label: "수수료", value: `$${t.feesUsd.toFixed(2)} (손익에 포함)` });
  rows.push({ label: "최대 역행", value: `${t.maxAdversePct.toFixed(2)}%` });
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

/**
 * Unrealized PnL of the backtest's open trades at the live price, after the entry fee
 * (the backtest's own open-trade PnL). A coin without a live price keeps the PnL the
 * backtest ended with. Null when no trade is open. Coins in `skip` (carried on by the
 * dry run) are left out.
 */
export function backtestOpenPnl(
  report: BacktestReport | null,
  midByCoin: Record<string, number | null | undefined>,
  skip: ReadonlySet<string> = new Set(),
): number | null {
  let sum = 0;
  let any = false;
  for (const [coin, trades] of Object.entries(report?.tradesByCoin ?? {})) {
    if (skip.has(coin)) continue;
    for (const t of trades) {
      if (t.exitTs != null) continue;
      any = true;
      const mid = midByCoin[coin];
      if (mid == null || !(mid > 0)) {
        sum += t.pnlUsd;
        continue;
      }
      const gross = (t.side === "long" ? mid - t.entryPx : t.entryPx - mid) * t.size;
      sum += gross - t.feesUsd;
    }
  }
  return any ? sum : null;
}
