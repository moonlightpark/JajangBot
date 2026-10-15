/** Shared by `bun run backtest` and `bun run sweep`: CLI args, fees, and cached Bybit 1m candles. */
import { MINUTE_MS } from "./backtest";
import { publicGet } from "./bybit-api";
import type { Ohlc } from "./chart";
import { MAGINGA } from "./strategy";

export const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const num = (x: unknown) => Number(x);

/** Bybit default (non VIP) linear fees. Override with BACKTEST_MAKER_FEE / BACKTEST_TAKER_FEE in percent. */
export const makerFee = Number(process.env.BACKTEST_MAKER_FEE ?? "0.02") / 100;
export const takerFee = Number(process.env.BACKTEST_TAKER_FEE ?? "0.055") / 100;
/** The live bot seeds its EMA from 1000 15m candles, so the backtest warms up on the same span. */
export const WARMUP_MS = 1000 * MAGINGA.periodMs;
const PAGE = 1000;

/** `months` calendar months before now, on a minute. */
export function monthsAgo(months: number, now = Date.now()): number {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return Math.floor(d.getTime() / MINUTE_MS) * MINUTE_MS;
}

async function fetchMinutes(base: string, symbol: string, from: number, to: number): Promise<Ohlc[]> {
  const out: Ohlc[] = [];
  for (let s = from; s < to; s += PAGE * MINUTE_MS) {
    const end = Math.min(to, s + PAGE * MINUTE_MS) - 1;
    let r: { list?: unknown[][] } | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        r = await publicGet<{ list?: unknown[][] }>(base, "/v5/market/kline", {
          category: "linear", symbol, interval: "1", start: s, end, limit: PAGE,
        });
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        await Bun.sleep(1000 * (attempt + 1));
      }
    }
    for (const row of r?.list ?? []) {
      out.push({ ts: num(row[0]), open: num(row[1]), high: num(row[2]), low: num(row[3]), close: num(row[4]) });
    }
  }
  return out;
}

/** 1m candles in [from, to), from the cache plus whatever is missing on either side. */
export async function minutes(base: string, symbol: string, from: number, to: number): Promise<Ohlc[]> {
  const file = Bun.file(`.backtest-cache/${symbol}-1m.json`);
  let bars: Ohlc[] = (await file.exists()) ? await file.json() : [];
  const first = bars[0]?.ts, last = bars.at(-1)?.ts;
  const fresh: Ohlc[] = [];
  if (first == null || last == null) fresh.push(...(await fetchMinutes(base, symbol, from, to)));
  else {
    if (from < first) fresh.push(...(await fetchMinutes(base, symbol, from, first)));
    if (last + MINUTE_MS < to) fresh.push(...(await fetchMinutes(base, symbol, last + MINUTE_MS, to)));
  }
  if (fresh.length) {
    const byTs = new Map<number, Ohlc>();
    for (const b of [...bars, ...fresh]) byTs.set(b.ts, b);
    bars = [...byTs.values()].sort((a, b) => a.ts - b.ts);
    await Bun.write(file, JSON.stringify(bars));
  }
  return bars.filter((b) => b.ts >= from && b.ts < to);
}

export async function instrument(base: string, symbol: string) {
  const r = await publicGet<{ list?: any[] }>(base, "/v5/market/instruments-info", { category: "linear", symbol });
  const i = r.list?.[0];
  if (!i) throw new Error(`unknown Bybit symbol ${symbol}`);
  return {
    qtyStep: num(i.lotSizeFilter?.qtyStep) || 0.001,
    minQty: num(i.lotSizeFilter?.minOrderQty) || 0,
    minNotional: num(i.lotSizeFilter?.minNotionalValue) || 0,
    maxLeverage: Math.floor(num(i.leverageFilter?.maxLeverage)) || 1,
  };
}
