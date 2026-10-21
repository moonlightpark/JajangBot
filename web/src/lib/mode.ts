import type { Meta } from "./bot-types";

export interface TradingMode {
  /** Short status word: 실거래 (Live), 테스트넷, 데모, or 모의거래 (Dry run). */
  label: string;
  /** Where it trades, e.g. "Bybit 데모 트레이딩" or "Bybit 데모 시세, 가상 체결". */
  detail: string;
  /** True only when real funds move: real orders on mainnet. */
  real: boolean;
}

const VENUES: Record<string, string> = { bybit: "Bybit" };
const NETWORKS: Record<string, string> = { demo: "데모", testnet: "테스트넷", mainnet: "메인넷" };

/**
 * What the bot is actually doing, from its .env as reported in meta.
 * `wallet` is the selected sleeve's; null means that sleeve has no key and simulates fills.
 */
export function tradingMode(meta: Pick<Meta, "venue" | "network" | "dryRun">, wallet: string | null): TradingMode {
  const venue = VENUES[meta.venue] ?? meta.venue;
  if (meta.dryRun || !wallet) {
    const prices = meta.network === "mainnet" ? "" : ` ${NETWORKS[meta.network] ?? meta.network}`;
    return { label: "모의거래", detail: `${venue}${prices} 시세, 가상 체결`, real: false };
  }
  if (meta.network === "mainnet") return { label: "실거래", detail: `${venue} 메인넷`, real: true };
  if (meta.network === "demo") return { label: "데모", detail: `${venue} 데모 트레이딩`, real: false };
  return { label: "테스트넷", detail: `${venue} 테스트넷`, real: false };
}

/** Who makes the buy/sell call, from MODEL in the bot's .env. Only `jev` is Jev. */
export function deciderLabel(model: string): string {
  if (model === "jev") return "Jev";
  if (model === "strategy") return "TradingView 전략";
  if (model === "mock") return "모의 모델";
  return model || "알 수 없음";
}
