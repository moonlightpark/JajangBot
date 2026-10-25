import { readRuntime, resolveDryRun } from "./runtime";

const env = (key: string, fallback?: string) => process.env[key] ?? fallback;

export type JevProvider = "typesafe" | "gateway";

export function resolveJevProvider(e: {
  JEV_PROVIDER?: string;
  TYPESAFE_API_KEY?: string;
  AI_GATEWAY_API_KEY?: string;
}): JevProvider {
  const explicit = e.JEV_PROVIDER?.trim().toLowerCase();
  if (explicit === "typesafe" || explicit === "gateway") return explicit;
  if (explicit) throw new Error("JEV_PROVIDER must be typesafe or gateway");
  if (e.TYPESAFE_API_KEY?.trim()) return "typesafe";
  if (e.AI_GATEWAY_API_KEY?.trim()) return "gateway";
  return "typesafe";
}

export function resolveJevModelId(e: { JEV_MODEL_ID?: string }, provider: JevProvider): string {
  const set = e.JEV_MODEL_ID?.trim();
  if (set) return set;
  return provider === "gateway" ? "typesafe-ai/jev" : "jev-latest";
}

export function assertJevCredentials(
  model: string,
  provider: JevProvider,
  e: { TYPESAFE_API_KEY?: string; AI_GATEWAY_API_KEY?: string },
): void {
  if (model !== "jev") return;
  if (provider === "typesafe" && !e.TYPESAFE_API_KEY?.trim()) {
    throw new Error("MODEL=jev with JEV_PROVIDER=typesafe needs TYPESAFE_API_KEY. Get a key at https://docs.typesafe.ai/ or set JEV_PROVIDER=gateway with AI_GATEWAY_API_KEY.");
  }
  if (provider === "gateway" && !e.AI_GATEWAY_API_KEY?.trim()) {
    throw new Error("MODEL=jev with JEV_PROVIDER=gateway needs AI_GATEWAY_API_KEY. Or set JEV_PROVIDER=typesafe with TYPESAFE_API_KEY.");
  }
}

/** Positive number from env, or null when unset, empty, or 0 (no cap). */
function cap(key: string): number | null {
  const n = Number(env(key, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type BybitEnv = "demo" | "testnet" | "mainnet";

export type ModelName = "mock" | "jev" | "strategy";

/** mock = momentum stand-in, jev = Jev decides, strategy = the TradingView rules in src/strategy.ts. */
export function resolveModel(raw?: string): ModelName {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v === "mock") return "mock";
  if (v === "jev" || v === "strategy") return v;
  throw new Error("MODEL must be mock, jev, or strategy");
}

export type StrategyExit = "opposite" | "mid";

export function resolveStrategyExit(raw?: string): StrategyExit {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v === "opposite") return "opposite";
  if (v === "mid") return "mid";
  throw new Error("STRATEGY_EXIT must be opposite or mid");
}

export function resolveEmaLen(raw?: string): number {
  if (!raw?.trim()) return 125;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2 || n > 900) throw new Error("STRATEGY_EMA_LEN must be a whole number from 2 to 900");
  return n;
}

/** A whole number from `min` to `max`; empty is `fallback`. Names the variable when it is off. */
export function resolveWhole(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

/** "50,70": bars before each add (STRATEGY_ADD_GAP_BARS). One number applies to every add. */
export function resolveGaps(name: string, raw: string | undefined, fallback: number[], min: number, max: number): number[] {
  if (!raw?.trim()) return fallback;
  return raw.split(",").map((part) => resolveWhole(name, part.trim() || "x", 0, min, max));
}

/** STRATEGY_PARTIAL_TP_PCT: percent of the position, above 0 and below 100. Empty: off. */
export function resolvePartialTp(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n >= 100) throw new Error("STRATEGY_PARTIAL_TP_PCT must be above 0 and below 100");
  return n / 100;
}

/** A share of the position: "2/3", or a percent like "66.7". Above 0 and below 1. Empty: off. */
export function resolveShare(name: string, raw: string | undefined): number | null {
  const v = raw?.trim();
  if (!v) return null;
  const [a, b] = v.split("/");
  const n = b != null ? Number(a) / Number(b) : Number(v) / 100;
  if (!Number.isFinite(n) || n <= 0 || n >= 1) throw new Error(`${name} must be a share like 2/3 or a percent above 0 and below 100`);
  return n;
}

/**
 * BACKTEST_FROM: when the backtest starts. "2026-07-01" is 00:00 KST that day; a full time
 * ("2026-07-01T09:00:00Z") is read as written. Empty: null, the last 3 months, rolling.
 */
export function resolveBacktestFrom(raw: string | undefined, now = Date.now()): number | null {
  const v = raw?.trim();
  if (!v) return null;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00+09:00`) : Date.parse(v);
  if (!Number.isFinite(t)) throw new Error(`BACKTEST_FROM must be a date like 2026-07-01, got ${v}`);
  if (t >= now) throw new Error(`BACKTEST_FROM ${v} is not in the past`);
  return t;
}

export function resolveBybitEnv(raw?: string): BybitEnv {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v === "demo") return "demo";
  if (v === "testnet" || v === "mainnet") return v;
  throw new Error("BYBIT_ENV must be demo, testnet, or mainnet");
}

const bybitEnv = resolveBybitEnv(env("BYBIT_ENV"));
const jevProvider = resolveJevProvider(process.env);
const jevModelId = resolveJevModelId(process.env, jevProvider);

export const config = {
  venue: "bybit" as const,
  /** demo = Bybit demo trading (mainnet prices, virtual funds). mainnet is real money, only when set. */
  bybitEnv,
  tickMs: Number(env("TICK_MS", "2000")),
  /** Book/price prints for the chart. Independent of Jev ticks. */
  priceMs: Math.max(50, Number(env("PRICE_MS", "200"))),
  /** Bybit fills have no public tx, so there is no explorer link. */
  explorerTx: "",
  /** The dashboard's 가상매매 switch (.runtime.json) when it was used, else DRY_RUN. */
  dryRun: resolveDryRun(env("DRY_RUN"), readRuntime()),
  /** Password for the dashboard's 가상매매 switch. Empty: the switch only shows the state. */
  adminToken: env("ADMIN_TOKEN", "")!.trim(),
  /** Target notional of one post-only quote. */
  quoteUsd: Number(env("QUOTE_USD", "40")),
  quoteInsideTicks: Number(env("QUOTE_INSIDE_TICKS", "1")),
  /** How far an IOC exit crosses the touch so it fills on the spot. */
  closeSlippageBps: Number(env("CLOSE_SLIPPAGE_BPS", "5")),
  /** Max open notional per sleeve. An open that would grow past it sends no order. null = no cap. */
  maxPositionUsd: cap("MAX_POSITION_USD"),
  /** Ceiling on the leverage rungs Jev can pick, below the coin max. null = coin max. */
  maxLeverage: cap("MAX_LEVERAGE"),
  /**
   * Account leverage cap: the open position at most this many times the balance (1 = up to
   * the balance). Set, it also sizes every entry: the cap split over the strategy's entries
   * (1 + STRATEGY_MAX_ADDS), in place of QUOTE_USD, so the last entry still fits. An entry
   * that would pass the cap shrinks to fit, or is skipped under the venue minimum. Apart from
   * STRATEGY_LEVERAGE, which only sets the margin Bybit holds. null: no cap, QUOTE_USD sizes.
   */
  maxAccountLeverage: cap("MAX_ACCOUNT_LEVERAGE"),
  /** Risk watchdog: close all at this percent against the average entry, and on Bybit a server-side stop there. null: off. */
  riskStopPct: cap("RISK_STOP_PCT"),
  /** Risk watchdog: close all when 6h turnover is under this percent of the 24h average per 6h (20 = 20%). null: off. */
  riskVolumeRatio: cap("RISK_VOLUME_PCT") == null ? null : cap("RISK_VOLUME_PCT")! / 100,
  /** How often the risk watchdog looks, apart from the model's tick. */
  riskCheckMs: Math.max(1000, Number(env("RISK_CHECK_MS", "5000")) || 5000),
  /** A book older than this is stale: the watchdog flags it and holds new entries. */
  riskStaleMs: Math.max(5000, Number(env("RISK_STALE_MS", "60000")) || 60000),
  /** Daily report time, hour in UTC+9 (23 = 23:00 KST). Empty: no daily report. */
  dailyReportHourKst: resolveWhole("DAILY_REPORT_HOUR_KST", env("DAILY_REPORT_HOUR_KST"), -1, 0, 23),
  horizonBlocks: Number(env("HORIZON_BLOCKS", "100")),
  model: resolveModel(env("MODEL")),
  /** MODEL=strategy: leverage for entries. The script's labels say x3. */
  strategyLeverage: Math.max(1, Number(env("STRATEGY_LEVERAGE", "3")) || 3),
  /** MODEL=strategy variant (src/strategy.ts StrategyRules). Unset, each is the script as written. */
  strategyEmaLen: resolveEmaLen(env("STRATEGY_EMA_LEN")),
  /** Stop loss as a fraction (STRATEGY_STOP_PCT=5 is 0.05). null: no stop. */
  strategyStopPct: cap("STRATEGY_STOP_PCT") == null ? null : cap("STRATEGY_STOP_PCT")! / 100,
  strategyExit: resolveStrategyExit(env("STRATEGY_EXIT")),
  strategyOnBarClose: env("STRATEGY_ON_BAR_CLOSE") === "true",
  strategyExitLive: env("STRATEGY_EXIT_LIVE") === "true",
  /** Stop at the low/high between the last two entries once the last entry is in. */
  strategySwingStop: env("STRATEGY_SWING_STOP") === "true",
  /** Share taken at the first entry's price once every entry is in ("2/3"). Empty: off. */
  strategyFirstPriceTp: resolveShare("STRATEGY_FIRST_PRICE_TP", env("STRATEGY_FIRST_PRICE_TP")),
  /** Share taken after the re-entry, back at the first-price take profit's price ("50"). Empty: off. */
  strategyRetakeTp: resolveShare("STRATEGY_RETAKE_TP", env("STRATEGY_RETAKE_TP")),
  /** Share taken at the channel middle after the first entry (70 -> 0.7). Empty: off. */
  strategyPartialTp: resolvePartialTp(env("STRATEGY_PARTIAL_TP_PCT")),
  /** Adds (물타기) after the first entry, same side. 0: none, as in the script. */
  strategyMaxAdds: resolveWhole("STRATEGY_MAX_ADDS", env("STRATEGY_MAX_ADDS"), 0, 0, 10),
  /** 15m bars after an entry before the next add may go in, one per add ("50,70"). */
  strategyAddGapBars: resolveGaps("STRATEGY_ADD_GAP_BARS", env("STRATEGY_ADD_GAP_BARS"), [50], 1, 10_000),
  /** Backtest start (BACKTEST_FROM). null: the last 3 months, which moves with every restart. */
  backtestFrom: resolveBacktestFrom(env("BACKTEST_FROM")),
  /** Days of 15m candles loaded at start, so the chart reaches back that far. At least 1000 bars either way. */
  chartDays: Math.max(1, Number(env("CHART_DAYS", "92")) || 92),
  /** typesafe = official TypeSafe API. gateway = Vercel AI Gateway. */
  jevProvider,
  jevModelId,
  jevUsdPerMTok: 0.042,
  port: Number(env("PORT", "3000")),
  /** Interface the API binds to. 127.0.0.1 behind nginx keeps PORT off the public network. */
  host: env("HOST", "0.0.0.0"),
  historySize: 1000,
  /** Dry run starting balance, all coins together. Each sleeve starts with an equal share. */
  bankrollUsd: Math.max(0, Number(env("BANKROLL_USD", "500")) || 0),
  /** Dry run fills pay Bybit's default (non VIP) linear fees: maker on resting entries, taker on IOC exits. */
  simMakerFee: 0.0002,
  simTakerFee: 0.00055,
};
