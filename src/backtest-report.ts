/** The MODEL=strategy backtest over a window, shared by `bun run backtest` and the bot's startup run. */
import { BACKTEST_LATEST, MINUTE_MS, runBacktest, type BacktestResult } from "./backtest";
import { instrument, makerFee, minutes, monthsAgo, takerFee, WARMUP_MS } from "./backtest-data";
import { bybitHosts, bybitSymbol } from "./bybit-api";
import { config } from "./config";
import { clampLeverage } from "./plan";
import { liveStrategy } from "./model";
import type { BacktestReport } from "./types";

export interface CoinRun {
  coin: string;
  leverage: number;
  bars: number;
  result: BacktestResult;
}

export interface BacktestRun {
  report: BacktestReport;
  runs: CoinRun[];
  failed: Array<{ coin: string; error: string }>;
}

/** Runs the live strategy on each coin's 1m candles in [start, end). A coin that fails is listed in `failed`. */
export async function backtestCoins(
  coins: string[],
  start: number,
  end: number,
  onLoading: (coin: string) => void = () => {},
): Promise<BacktestRun> {
  const base = bybitHosts(config.bybitEnv).publicRest;
  const report: BacktestReport = { from: start, to: end, ranAt: Date.now(), quoteUsd: config.quoteUsd, leverageByCoin: {}, tradesByCoin: {} };
  const runs: CoinRun[] = [];
  const failed: BacktestRun["failed"] = [];
  for (const coin of coins) {
    const symbol = bybitSymbol(coin);
    try {
      const inst = await instrument(base, symbol);
      const leverage = clampLeverage(config.strategyLeverage, Math.min(inst.maxLeverage, config.maxLeverage ?? inst.maxLeverage));
      onLoading(coin);
      const bars = await minutes(base, symbol, start - WARMUP_MS, end);
      const result = runBacktest(bars, { startTs: start, leverage, quoteUsd: config.quoteUsd, makerFee, takerFee, ...inst, ...liveStrategy.rules,
        riskStopPct: config.riskStopPct, riskVolumeRatio: config.riskVolumeRatio, maxAccountLeverage: config.maxAccountLeverage, bankrollUsd: config.bankrollUsd / coins.length }, liveStrategy.params);
      report.leverageByCoin[coin] = leverage;
      report.tradesByCoin[coin] = result.trades;
      if (result.open) (report.openByCoin ??= {})[coin] = result.open;
      runs.push({ coin, leverage, bars: bars.length, result });
    } catch (e) {
      failed.push({ coin, error: (e as Error).message });
    }
  }
  return { report, runs, failed };
}

/**
 * At bot startup: the backtest from BACKTEST_FROM (or the last `months`) up to `now`, saved to latest.json so the
 * chart and the dry run balance run right up to the moment the bot starts deciding.
 * If any coin fails (Bybit cannot be reached), the last saved report stays as it was,
 * so one coin's trades never vanish from the chart.
 */
export async function refreshBacktest(coins: string[], now = Date.now(), months = 3, from = config.backtestFrom): Promise<BacktestRun | null> {
  const end = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  // BACKTEST_FROM fixes the start, so the backtest's closed PnL does not shift with each restart.
  const start = from != null ? Math.floor(from / MINUTE_MS) * MINUTE_MS : monthsAgo(months, end);
  const run = await backtestCoins(coins, start, end);
  for (const f of run.failed) console.log(`backtest ${f.coin}: failed: ${f.error}`);
  if (run.failed.length || !run.runs.length) return null;
  await Bun.write(BACKTEST_LATEST, JSON.stringify(run.report));
  return run;
}
