import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import type { DailyReport, Fill } from "./types";

/** One line per report per coin. Gitignored. */
export const DAILY_FILE = "reports/daily.jsonl";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const KST_MS = 9 * HOUR_MS;

/** The next `hourKst`:00 KST after `now`. */
export function nextReportAt(now: number, hourKst: number): number {
  const kst = now + KST_MS;
  const dayStart = Math.floor(kst / DAY_MS) * DAY_MS;
  let at = dayStart + hourKst * HOUR_MS;
  if (at <= kst) at += DAY_MS;
  return at - KST_MS;
}

/** "2026-10-25", the KST date a report closes on. */
export function kstDate(ts: number): string {
  return new Date(ts + KST_MS).toISOString().slice(0, 10);
}

export type DailyMark = {
  at: number;
  equityUsd: number;
  realizedUsd: number;
  feesUsd: number;
  position: { side: "long" | "short"; size: number; entryPx: number; mid: number } | null;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The day from `start` to `end`: fills in between, closed PnL and fees as differences of the
 * running totals, and the balance at both ends. `sinceStart` is true when the bot started
 * inside the window, so the day is only partly covered.
 */
export function buildDailyReport(
  coin: string,
  start: DailyMark,
  end: DailyMark,
  fills: { ts: number; fill: Fill }[],
  sinceStart: boolean,
): DailyReport {
  const day = fills.filter((f) => f.ts >= start.at && f.ts < end.at).map((f) => f.fill);
  const slips = day.map((f) => f.slipBps).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const pnlUsd = end.equityUsd - start.equityUsd;
  return {
    coin,
    date: kstDate(end.at),
    from: start.at,
    to: end.at,
    ...(sinceStart ? { sinceStart: true } : {}),
    startBalance: r2(start.equityUsd),
    endBalance: r2(end.equityUsd),
    pnlUsd: r2(pnlUsd),
    pnlPct: start.equityUsd > 0 ? r2((pnlUsd / start.equityUsd) * 100) : 0,
    realizedUsd: r2(end.realizedUsd - start.realizedUsd),
    feesUsd: r2(end.feesUsd - start.feesUsd),
    entries: day.filter((f) => f.dir !== "close").length,
    closes: day.filter((f) => f.dir === "close").length,
    riskCloses: day.filter((f) => f.risk).length,
    avgSlipBps: slips.length ? r2(slips.reduce((a, b) => a + b, 0) / slips.length) : null,
    maxSlipBps: slips.length ? r2(Math.max(...slips)) : null,
    open: end.position ? { side: end.position.side, size: end.position.size, entryPx: r2(end.position.entryPx) } : null,
  };
}

/** One line for the log. */
export function dailyLine(r: DailyReport): string {
  const sign = (x: number) => `${x < 0 ? "-" : "+"}$${Math.abs(x).toFixed(2)}`;
  const slip = r.avgSlipBps == null ? "" : `, slippage avg ${r.avgSlipBps}bps max ${r.maxSlipBps}bps`;
  const open = r.open ? `, open ${r.open.side} ${r.open.size} @ ${r.open.entryPx}` : ", flat";
  return `daily ${r.coin} ${r.date}${r.sinceStart ? " (since start)" : ""}: balance $${r.startBalance.toFixed(2)} -> $${r.endBalance.toFixed(2)} (${sign(r.pnlUsd)}, ${r.pnlPct}%), realized ${sign(r.realizedUsd)}, fees $${r.feesUsd.toFixed(2)}, entries ${r.entries}, closes ${r.closes}, risk closes ${r.riskCloses}${slip}${open}`;
}

export function saveDailyReport(r: DailyReport, file = DAILY_FILE) {
  const dir = file.slice(0, file.lastIndexOf("/"));
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(file, JSON.stringify(r) + "\n");
}

/** Saved reports, newest first, at most `limit`. A bad line is skipped. */
export function readDailyReports(file = DAILY_FILE, limit = 60): DailyReport[] {
  if (!existsSync(file)) return [];
  const out: DailyReport[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as DailyReport;
      if (r && typeof r.date === "string" && typeof r.coin === "string") out.push(r);
    } catch {
      // skip
    }
  }
  return out.reverse().slice(0, limit);
}
