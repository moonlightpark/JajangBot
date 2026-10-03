import { existsSync, readFileSync } from "node:fs";

/** Bybit linear perps are quoted in USDT. */
export function coinPair(coin: string): string {
  return `${coin}-USDT`;
}

export function sameCoin(a: string | undefined, b: string): boolean {
  return !!a && a === b;
}

export interface SleeveConfig {
  coin: string;
  pair: string;
  label: string;
  /** Bybit sub-account API key pair for this coin. */
  bybit?: { apiKey: string; apiSecret: string };
}

/** True when the sleeve has what it needs to send real orders. */
export function hasKeys(s: SleeveConfig): boolean {
  return !!s.bybit;
}

type BybitKey = { apiKey: string; apiSecret: string };
type BybitKeyFile = { sleeves?: { coin?: string; apiKey?: string; apiSecret?: string }[] };

/** Parse `.bybit-keys.json` or `BYBIT_KEYS_JSON`: {"sleeves":[{"coin","apiKey","apiSecret"}]}. */
export function parseBybitKeysJson(raw: string): Map<string, BybitKey> {
  const out = new Map<string, BybitKey>();
  try {
    const parsed = JSON.parse(raw) as BybitKeyFile;
    for (const s of parsed?.sleeves ?? []) {
      const apiKey = s.apiKey?.trim(), apiSecret = s.apiSecret?.trim();
      if (s.coin && apiKey && apiSecret) out.set(s.coin, { apiKey, apiSecret });
    }
  } catch {
    // ignore junk
  }
  return out;
}

/** `.bybit-keys.json`, then `BYBIT_KEYS_JSON` on top. */
function loadBybitKeys(): Map<string, BybitKey> {
  const out = new Map<string, BybitKey>();
  if (existsSync(".bybit-keys.json")) {
    for (const [coin, key] of parseBybitKeysJson(readFileSync(".bybit-keys.json", "utf8"))) out.set(coin, key);
  }
  const fromEnv = process.env.BYBIT_KEYS_JSON;
  if (fromEnv) {
    for (const [coin, key] of parseBybitKeysJson(fromEnv)) out.set(coin, key);
  }
  return out;
}

/** First coin can use BYBIT_API_KEY/BYBIT_API_SECRET. Others use BYBIT_KEYS_JSON or `.bybit-keys.json`. */
export function loadSleeves(): SleeveConfig[] {
  const listed = (process.env.COINS ?? "BTC,ETH,SOL,DOGE,BNB")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const keys = loadBybitKeys();
  const apiKey = process.env.BYBIT_API_KEY?.trim(), apiSecret = process.env.BYBIT_API_SECRET?.trim();
  const first = apiKey && apiSecret ? { apiKey, apiSecret } : undefined;
  return listed.map((coin, i) => ({
    coin,
    pair: coinPair(coin),
    label: coin,
    bybit: keys.get(coin) ?? (i === 0 ? first : undefined),
  }));
}
