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
  dryRun: env("DRY_RUN") === "true",
  /** Target notional of one post-only quote. */
  quoteUsd: Number(env("QUOTE_USD", "40")),
  quoteInsideTicks: Number(env("QUOTE_INSIDE_TICKS", "1")),
  /** How far an IOC exit crosses the touch so it fills on the spot. */
  closeSlippageBps: Number(env("CLOSE_SLIPPAGE_BPS", "5")),
  /** Max open notional per sleeve. An open that would grow past it sends no order. null = no cap. */
  maxPositionUsd: cap("MAX_POSITION_USD"),
  /** Ceiling on the leverage rungs Jev can pick, below the coin max. null = coin max. */
  maxLeverage: cap("MAX_LEVERAGE"),
  horizonBlocks: Number(env("HORIZON_BLOCKS", "100")),
  model: resolveModel(env("MODEL")),
  /** MODEL=strategy: leverage for entries. The script's labels say x3. */
  strategyLeverage: Math.max(1, Number(env("STRATEGY_LEVERAGE", "3")) || 3),
  /** typesafe = official TypeSafe API. gateway = Vercel AI Gateway. */
  jevProvider,
  jevModelId,
  jevUsdPerMTok: 0.042,
  port: Number(env("PORT", "3000")),
  historySize: 1000,
  bankrollUsd: Number(env("BANKROLL_USD", "200")),
};
