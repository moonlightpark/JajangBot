/**
 * MODEL=strategy backtest on Bybit 1m candles.
 *
 *   bun run backtest                     # from BACKTEST_FROM, else the last 3 months; COINS from .env
 *   bun run backtest --months=6
 *   bun run backtest --from=2026-07-01 --coins=BTC,ETH
 *
 * Candles are cached in .backtest-cache/, trades go to backtest-results/.
 * backtest-results/latest.json is what the dashboard chart shows.
 */
import { BACKTEST_LATEST as LATEST, MINUTE_MS } from "./backtest";
import { arg, makerFee, monthsAgo, takerFee } from "./backtest-data";
import { backtestCoins } from "./backtest-report";
import { config } from "./config";
import { describeStrategy, liveStrategy } from "./model";

function startTs(): number {
  const from = arg("from");
  if (from) {
    const t = Date.parse(from);
    if (!Number.isFinite(t)) throw new Error(`--from must be a date like 2026-07-10, got ${from}`);
    return t;
  }
  if (config.backtestFrom != null && !arg("months")) return config.backtestFrom;
  const months = Number(arg("months") ?? "3");
  if (!(months > 0)) throw new Error("--months must be a positive number");
  return monthsAgo(months);
}

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const time = (ts: number) => new Date(ts).toISOString().slice(0, 16).replace("T", " ");
const usd = (x: number) => `${x < 0 ? "-" : ""}$${Math.abs(x).toFixed(2)}`;

const coins = (arg("coins") ?? process.env.COINS ?? "BTC,ETH,SOL,DOGE,BNB").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
const start = startTs();
const end = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;

if (config.model !== "strategy") console.log(`note: MODEL=${config.model}, but the backtest only runs the TradingView strategy (Jev is not called).`);
if (config.tickMs !== MINUTE_MS) console.log(`note: TICK_MS=${config.tickMs}, but the backtest decides once per 1m candle.`);
console.log(`backtest strategy ${liveStrategy.params.timeframe} channel (${describeStrategy()}), 1m ticks, ${day(start)} to ${day(end)}, quote $${config.quoteUsd}, fees maker ${makerFee * 100}% taker ${takerFee * 100}%`);

const rows: string[] = ["coin,side,entry_time_utc,entry_px,exit_time_utc,exit_px,size,pnl_usd,fees_usd,max_adverse_pct,status,entries,partial"];
let total = 0, totalFees = 0, totalTrades = 0;
const { report, runs, failed } = await backtestCoins(coins, start, end, (coin) => process.stdout.write(`${coin}: loading 1m candles... `));

for (const { coin, leverage, bars, result: r } of runs) {
  console.log(`${bars}`);
  const done = r.trades.filter((t) => t.exitTs != null);
  const wins = done.filter((t) => t.pnlUsd > 0).length;
  const open = r.trades.find((t) => t.exitTs == null);
  // Isolated margin at this leverage is gone after roughly 100/leverage percent against you.
  // A partial take profit shares its position with a later trade, so count the position once.
  const liqRisk = r.trades.filter((t) => !t.partial && t.maxAdversePct >= 100 / leverage - 0.5).length;
  const partials = r.trades.filter((t) => t.partial).length;
  const adds = r.trades.reduce((n, t) => n + (t.partial ? 0 : Math.max(0, (t.entries?.length ?? 1) - 1)), 0);
  console.log(
    `  ${leverage}x  trades ${done.length}  win ${done.length ? Math.round((wins / done.length) * 100) : 0}%  pnl ${usd(r.pnlUsd)}  fees ${usd(r.feesUsd)}  max drawdown ${usd(r.maxDrawdownUsd)}  missed entries ${r.missedEntries}` +
    (adds ? `  adds ${adds}` : "") +
    (partials ? `  partial take profits ${partials}` : "") +
    (r.riskCloses ? `  risk closes ${r.riskCloses}` : "") +
    (open ? `  open ${open.side} @ ${open.entryPx} (${usd(open.pnlUsd)})` : "") +
    (liqRisk ? `  liquidation risk (isolated) ${liqRisk}` : ""),
  );
  for (const t of r.trades) {
    rows.push([coin, t.side, time(t.entryTs), t.entryPx, t.exitTs == null ? "" : time(t.exitTs), t.exitPx, t.size,
      t.pnlUsd.toFixed(4), t.feesUsd.toFixed(4), t.maxAdversePct.toFixed(2), t.exitTs == null ? "open" : "closed", t.entries?.length ?? 1, t.partial ? 1 : 0].join(","));
  }
  total += r.pnlUsd;
  totalFees += r.feesUsd;
  totalTrades += done.length;
}
for (const f of failed) console.log(`\n${f.coin}: failed: ${f.error}`);

const out = `backtest-results/${day(start)}_${day(end)}.csv`;
await Bun.write(out, rows.join("\n") + "\n");
console.log(`total  trades ${totalTrades}  pnl ${usd(total)}  fees ${usd(totalFees)}`);
// The bot serves this file at GET /backtest so the dashboard chart can mark the trades.
if (Object.keys(report.tradesByCoin).length) await Bun.write(LATEST, JSON.stringify(report));
console.log(`trades saved to ${out} and ${LATEST}`);
