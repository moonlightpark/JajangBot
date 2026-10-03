import type { Meta } from "./bot-types";

export interface TradingMode {
  /** Short status word: Live, Testnet, Demo, or Dry run. */
  label: string;
  /** Where it trades, e.g. "Bybit demo trading" or "Bybit demo prices, simulated fills". */
  detail: string;
  /** True only when real funds move: real orders on mainnet. */
  real: boolean;
}

const VENUES: Record<string, string> = { bybit: "Bybit" };

/**
 * What the bot is actually doing, from its .env as reported in meta.
 * `wallet` is the selected sleeve's; null means that sleeve has no key and simulates fills.
 */
export function tradingMode(meta: Pick<Meta, "venue" | "network" | "dryRun">, wallet: string | null): TradingMode {
  const venue = VENUES[meta.venue] ?? meta.venue;
  if (meta.dryRun || !wallet) {
    const prices = meta.network === "mainnet" ? "" : ` ${meta.network}`;
    return { label: "Dry run", detail: `${venue}${prices} prices, simulated fills`, real: false };
  }
  if (meta.network === "mainnet") return { label: "Live", detail: `${venue} mainnet`, real: true };
  if (meta.network === "demo") return { label: "Demo", detail: `${venue} demo trading`, real: false };
  return { label: "Testnet", detail: `${venue} testnet`, real: false };
}

/** Who makes the buy/sell call, from MODEL in the bot's .env. Only `jev` is Jev. */
export function deciderLabel(model: string): string {
  if (model === "jev") return "Jev";
  if (model === "strategy") return "TradingView strategy";
  if (model === "mock") return "mock model";
  return model || "unknown";
}
