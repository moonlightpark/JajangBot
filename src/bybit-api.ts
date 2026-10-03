import type { BybitEnv } from "./config";

export interface BybitHosts {
  /** Signed REST for orders, positions, wallet. */
  rest: string;
  /** Unsigned market data REST. */
  publicRest: string;
  publicWs: string;
  privateWs: string;
}

/**
 * Demo trading uses mainnet market data with its own trade and private hosts.
 * https://bybit-exchange.github.io/docs/v5/demo
 */
export function bybitHosts(env: BybitEnv): BybitHosts {
  if (env === "testnet") {
    return {
      rest: "https://api-testnet.bybit.com",
      publicRest: "https://api-testnet.bybit.com",
      publicWs: "wss://stream-testnet.bybit.com/v5/public/linear",
      privateWs: "wss://stream-testnet.bybit.com/v5/private",
    };
  }
  if (env === "mainnet") {
    return {
      rest: "https://api.bybit.com",
      publicRest: "https://api.bybit.com",
      publicWs: "wss://stream.bybit.com/v5/public/linear",
      privateWs: "wss://stream.bybit.com/v5/private",
    };
  }
  return {
    rest: "https://api-demo.bybit.com",
    publicRest: "https://api.bybit.com",
    publicWs: "wss://stream.bybit.com/v5/public/linear",
    privateWs: "wss://stream-demo.bybit.com/v5/private",
  };
}

/** Linear USDT perp symbol for a coin. */
export const bybitSymbol = (coin: string) => `${coin}USDT`;

export function hmacHex(secret: string, payload: string): string {
  return new Bun.CryptoHasher("sha256", secret).update(payload).digest("hex");
}

/** V5 REST signature: timestamp + apiKey + recvWindow + (query string | JSON body). */
export function signRest(secret: string, ts: number, apiKey: string, recvWindow: number, payload: string): string {
  return hmacHex(secret, `${ts}${apiKey}${recvWindow}${payload}`);
}

/** V5 private WS auth signature over `GET/realtime{expires}`. */
export function signWs(secret: string, expires: number): string {
  return hmacHex(secret, `GET/realtime${expires}`);
}

export class BybitError extends Error {
  constructor(readonly path: string, readonly retCode: number, retMsg: string) {
    super(`bybit ${path} ${retCode} ${retMsg}`);
  }
}

type Envelope<T> = { retCode?: number; retMsg?: string; result?: T };

function query(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

async function unwrap<T>(path: string, res: Response): Promise<T> {
  if (!res.ok) throw new Error(`bybit ${path} HTTP ${res.status}`);
  const body = (await res.json()) as Envelope<T>;
  if (body.retCode !== 0) throw new BybitError(path, Number(body.retCode), body.retMsg ?? "");
  return body.result as T;
}

export async function publicGet<T>(base: string, path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const qs = query(params);
  return unwrap<T>(path, await fetch(`${base}${path}${qs ? `?${qs}` : ""}`));
}

const RECV_WINDOW = 10_000;

/** Signed V5 client for one sub-account. The secret never leaves this object. */
export class BybitClient {
  constructor(private apiKey: string, private apiSecret: string, private base: string) {}

  private headers(payload: string): Record<string, string> {
    const ts = Date.now();
    return {
      "content-type": "application/json",
      "X-BAPI-API-KEY": this.apiKey,
      "X-BAPI-TIMESTAMP": String(ts),
      "X-BAPI-RECV-WINDOW": String(RECV_WINDOW),
      "X-BAPI-SIGN": signRest(this.apiSecret, ts, this.apiKey, RECV_WINDOW, payload),
    };
  }

  async get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const qs = query(params);
    return unwrap<T>(path, await fetch(`${this.base}${path}${qs ? `?${qs}` : ""}`, { headers: this.headers(qs) }));
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const raw = JSON.stringify(body);
    return unwrap<T>(path, await fetch(`${this.base}${path}`, { method: "POST", headers: this.headers(raw), body: raw }));
  }

  /** Args for the private WS `auth` op. */
  wsAuth(): [string, number, string] {
    const expires = Date.now() + RECV_WINDOW;
    return [this.apiKey, expires, signWs(this.apiSecret, expires)];
  }
}
