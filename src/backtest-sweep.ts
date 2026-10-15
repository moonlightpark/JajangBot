/**
 * Tries variants of the 15m channel strategy on past Bybit 1m candles.
 *
 *   bun run sweep                          # 12 months: tune on the first 9, check on the last 3
 *   bun run sweep --months=12 --test-months=3 --coins=BTC,ETH
 *
 * Variants are picked on the train months only. The test months are data the pick never
 * saw, so a variant that only fits the past shows up there. Every run uses the live order
 * model (post-only entries, taker exits, fees); nothing is sent to Bybit.
 * Results go to backtest-results/sweep_<from>_<to>_test<N>m.csv.
 */
import { MINUTE_MS, runBacktest, type BacktestOpts } from "./backtest";
import { arg, instrument, makerFee, minutes, monthsAgo, takerFee, WARMUP_MS } from "./backtest-data";
import { bybitHosts, bybitSymbol } from "./bybit-api";
import type { Ohlc } from "./chart";
import { config } from "./config";
import { clampLeverage } from "./plan";
import { liveStrategy } from "./model";
import { MAGINGA, type MagingaParams } from "./strategy";

type Variant = {
  emaLen: number;
  band: number;
  stopPct: number | null;
  exit: "opposite" | "mid";
  onBarClose: boolean;
};

type Score = { pnl: number; trades: number; wins: number; dd: number; stops: number; liq: number; upCoins: number };

const months = Number(arg("months") ?? "12");
const testMonths = Number(arg("test-months") ?? "3");
if (!(months > testMonths && testMonths > 0)) throw new Error("--months must be larger than --test-months, both positive");
const coins = (arg("coins") ?? process.env.COINS ?? "BTC,ETH,SOL,DOGE,BNB").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
const end = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
const start = monthsAgo(months, end);
const split = monthsAgo(testMonths, end);
const base = bybitHosts(config.bybitEnv).publicRest;

/** What the bot runs now (.env STRATEGY_*). */
const LIVE: Variant = { emaLen: liveStrategy.params.emaLen, band: liveStrategy.params.shortBand, ...liveStrategy.rules };
/** The TradingView script as written: EMA 125, 1.618% bands, no stop, exit at the far line, every minute. */
const SCRIPT: Variant = { emaLen: 125, band: MAGINGA.shortBand, stopPct: null, exit: "opposite", onBarClose: false };

const variants: Variant[] = [];
for (const emaLen of [75, 125, 200])
  for (const band of [0.01, MAGINGA.shortBand, 0.025, 0.0382])
    for (const stopPct of [null, 0.02, 0.03, 0.05])
      for (const exit of ["opposite", "mid"] as const)
        for (const onBarClose of [false, true]) variants.push({ emaLen, band, stopPct, exit, onBarClose });

const key = (v: Variant) =>
  `ema ${v.emaLen}, band ${(v.band * 100).toFixed(2)}%, stop ${v.stopPct ? `${v.stopPct * 100}%` : "none"}, exit ${v.exit}, ${v.onBarClose ? "bar close" : "every 1m"}`;
const params = (v: Variant): MagingaParams => ({
  ...MAGINGA,
  emaLen: v.emaLen,
  shortBand: v.band,
  // The script's long band is 1.619%, a hair off the short one. Keep it for the live pair only.
  longBand: v.band === MAGINGA.shortBand ? MAGINGA.longBand : v.band,
});
const empty = (): Score => ({ pnl: 0, trades: 0, wins: 0, dd: 0, stops: 0, liq: 0, upCoins: 0 });

/** First index with ts >= t (bars sorted by ts). */
function from(bars: Ohlc[], t: number): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.ts < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const usd = (x: number) => `${x < 0 ? "-" : "+"}$${Math.abs(x).toFixed(2)}`;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");

console.log(`sweep ${variants.length} variants on ${coins.join(" ")}: train ${day(start)} to ${day(split)}, test ${day(split)} to ${day(end)}, quote $${config.quoteUsd}`);

const train = variants.map(empty), test = variants.map(empty);

for (const coin of coins) {
  const symbol = bybitSymbol(coin);
  const inst = await instrument(base, symbol);
  const leverage = clampLeverage(config.strategyLeverage, Math.min(inst.maxLeverage, config.maxLeverage ?? inst.maxLeverage));
  process.stdout.write(`${coin}: loading 1m candles... `);
  const all = await minutes(base, symbol, start - WARMUP_MS, end);
  console.log(`${all.length}, running`);
  const trainBars = all.slice(0, from(all, split));
  const testBars = all.slice(from(all, split - WARMUP_MS));
  const opts = (v: Variant, startTs: number): BacktestOpts => ({
    startTs, leverage, quoteUsd: config.quoteUsd, makerFee, takerFee, ...inst,
    stopPct: v.stopPct, exit: v.exit, onBarClose: v.onBarClose,
  });
  variants.forEach((v, i) => {
    for (const [bars, startTs, into] of [[trainBars, start, train], [testBars, split, test]] as const) {
      const r = runBacktest(bars, opts(v, startTs), params(v));
      const s = into[i]!;
      const done = r.trades.filter((t) => t.exitTs != null);
      s.pnl += r.pnlUsd;
      s.trades += done.length;
      s.wins += done.filter((t) => t.pnlUsd > 0).length;
      s.dd += r.maxDrawdownUsd;
      s.stops += r.stops;
      // Isolated margin at this leverage is gone after roughly 100/leverage percent against you.
      s.liq += r.trades.filter((t) => t.maxAdversePct >= 100 / leverage - 0.5).length;
      if (r.pnlUsd > 0) s.upCoins++;
    }
  });
}

const row = (i: number) => {
  const a = train[i]!, b = test[i]!;
  return `${usd(a.pnl).padStart(9)} ${String(a.trades).padStart(5)} ${pct(a.wins, a.trades).padStart(4)} ${`$${a.dd.toFixed(0)}`.padStart(5)} ${`${a.upCoins}/${coins.length}`.padStart(4)} |` +
    ` ${usd(b.pnl).padStart(9)} ${String(b.trades).padStart(5)} ${pct(b.wins, b.trades).padStart(4)} ${`$${b.dd.toFixed(0)}`.padStart(5)} ${`${b.upCoins}/${coins.length}`.padStart(4)} ${String(a.liq + b.liq).padStart(4)}  ${key(variants[i]!)}`;
};
const head = `${"train pnl".padStart(9)} ${"trades".padStart(5)} ${"win".padStart(4)} ${"dd".padStart(5)} ${"up".padStart(4)} | ${"test pnl".padStart(9)} ${"trades".padStart(5)} ${"win".padStart(4)} ${"dd".padStart(5)} ${"up".padStart(4)} ${"liq".padStart(4)}  variant`;

const live = variants.findIndex((v) => key(v) === key(LIVE));
const byTrain = variants.map((_, i) => i).sort((a, b) => train[b]!.pnl - train[a]!.pnl);
console.log(`\npnl is summed over coins at $${config.quoteUsd} a trade; dd sums each coin's max drawdown; up = coins in profit; liq = trades that went ${(100 / clampLeverage(config.strategyLeverage, 50) - 0.5).toFixed(1)}%+ against (isolated liquidation risk)`);
console.log(head);
console.log("script as written");
console.log(row(variants.findIndex((v) => key(v) === key(SCRIPT))));
console.log("live (now, .env STRATEGY_*)");
console.log(live >= 0 ? row(live) : "  not in the grid");
console.log("top 10 by train pnl (picked without looking at test)");
for (const i of byTrain.slice(0, 10)) console.log(row(i));
if (live >= 0) console.log(`live variant ranks ${byTrain.indexOf(live) + 1} of ${variants.length} on train`);

const out = `backtest-results/sweep_${day(start)}_${day(end)}_test${testMonths}m.csv`;
const csv = ["ema_len,band_pct,stop_pct,exit,timing,train_pnl,train_trades,train_wins,train_dd,train_up_coins,test_pnl,test_trades,test_wins,test_dd,test_up_coins,liq_risk"];
variants.forEach((v, i) => {
  const a = train[i]!, b = test[i]!;
  csv.push([v.emaLen, (v.band * 100).toFixed(3), v.stopPct ? v.stopPct * 100 : "", v.exit, v.onBarClose ? "bar_close" : "every_1m",
    a.pnl.toFixed(4), a.trades, a.wins, a.dd.toFixed(4), a.upCoins, b.pnl.toFixed(4), b.trades, b.wins, b.dd.toFixed(4), b.upCoins, a.liq + b.liq].join(","));
});
await Bun.write(out, csv.join("\n") + "\n");
console.log(`all ${variants.length} variants saved to ${out}`);
