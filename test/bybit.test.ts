import { expect, test } from "bun:test";
import { quotePrice, snapToStep, stepDecimals, takerPrice } from "../src/book";
import { bybitHosts, bybitSymbol, signRest, signWs } from "../src/bybit-api";
import { BybitBook, bybitCandle, bybitTickerCtx } from "../src/bybit-feed";
import { accountFromBybit, bybitFillDir } from "../src/bybit-market";
import { resolveBybitEnv } from "../src/config";
import { coinPair, hasKeys, loadSleeves, parseBybitKeysJson } from "../src/sleeves";
import type { Book } from "../src/types";

test("BYBIT_ENV defaults to demo", () => {
  expect(resolveBybitEnv(undefined)).toBe("demo");
  expect(resolveBybitEnv("TESTNET")).toBe("testnet");
  expect(resolveBybitEnv("mainnet")).toBe("mainnet");
  expect(() => resolveBybitEnv("prod")).toThrow();
});

test("demo trades on api-demo but reads mainnet market data", () => {
  const demo = bybitHosts("demo");
  expect(demo.rest).toBe("https://api-demo.bybit.com");
  expect(demo.privateWs).toBe("wss://stream-demo.bybit.com/v5/private");
  expect(demo.publicWs).toBe("wss://stream.bybit.com/v5/public/linear");
  expect(bybitHosts("testnet").rest).toBe("https://api-testnet.bybit.com");
  expect(bybitHosts("mainnet").rest).toBe("https://api.bybit.com");
  expect(bybitSymbol("BTC")).toBe("BTCUSDT");
  expect(coinPair("BTC")).toBe("BTC-USDT");
});

test("V5 signatures are HMAC-SHA256 hex over the documented payloads", () => {
  const sig = signRest("secret", 1700000000000, "key", 5000, "category=linear&symbol=BTCUSDT");
  const want = new Bun.CryptoHasher("sha256", "secret").update("1700000000000key5000category=linear&symbol=BTCUSDT").digest("hex");
  expect(sig).toBe(want);
  expect(sig).toMatch(/^[0-9a-f]{64}$/);
  expect(signWs("secret", 1700000010000)).toBe(
    new Bun.CryptoHasher("sha256", "secret").update("GET/realtime1700000010000").digest("hex"),
  );
});

test("local book applies snapshot then delta, size 0 deletes", () => {
  const b = new BybitBook();
  b.apply("snapshot", { b: [["100", "1"], ["99", "2"]], a: [["101", "1"], ["102", "3"]] });
  b.apply("delta", { b: [["100", "0"], ["99.5", "4"]], a: [["101", "0.5"]] });
  const book = b.toBook(7)!;
  expect(book.bid).toBe(99.5);
  expect(book.ask).toBe(101);
  expect(book.block).toBe(7);
  b.apply("snapshot", { b: [["50", "1"]], a: [["51", "1"]] });
  expect(b.toBook(8)!.bid).toBe(50);
});

test("ticker maps onto the asset context Jev reads", () => {
  const ctx = bybitTickerCtx({ markPrice: "101", indexPrice: "100", fundingRate: "0.0001", openInterest: "5", prevPrice24h: "90", turnover24h: "1000" });
  expect(ctx.markPx).toBe(101);
  expect(ctx.oraclePx).toBe(100);
  expect(ctx.funding).toBe(0.0001);
  expect(ctx.premium).toBeCloseTo(0.01);
  expect(ctx.prevDayPx).toBe(90);
  expect(ctx.dayNtlVlm).toBe(1000);
  expect(bybitCandle(["1700000000000", "1", "2", "0.5", "1.5", "10", "15"], "1m")).toEqual({
    t: 1700000000000, o: "1", h: "2", l: "0.5", c: "1.5", i: "1m",
  });
});

test("tick helpers snap to the venue step and never cross", () => {
  expect(stepDecimals(0.001)).toBe(3);
  expect(stepDecimals(0.5)).toBe(1);
  expect(stepDecimals(1)).toBe(0);
  expect(stepDecimals(1e-7)).toBe(7);
  expect(snapToStep(0.0004705, 0.001, "floor")).toBe(0);
  expect(snapToStep(0.3, 0.1, "floor")).toBe(0.3);
  expect(snapToStep(0.0567, 0.001, "ceil")).toBe(0.057);
  const book = { bid: 100, ask: 100.5, mid: 100.25 } as Book;
  expect(quotePrice("buy", book, 0.1, 1)).toBe(100.1);
  expect(quotePrice("sell", book, 0.1, 1)).toBe(100.4);
  const tight = { bid: 100, ask: 100.1, mid: 100.05 } as Book;
  expect(quotePrice("buy", tight, 0.1, 1)).toBe(100);
  expect(quotePrice("sell", tight, 0.1, 1)).toBe(100.1);
  expect(takerPrice("buy", book, 0.1, 10)).toBe(100.7);
  expect(takerPrice("sell", book, 0.1, 10)).toBe(99.9);
});

test("account reads signed size from Bybit side", () => {
  const short = accountFromBybit(
    { symbol: "BTCUSDT", side: "Sell", size: "0.002", avgPrice: "85000", unrealisedPnl: "-1.5", leverage: "5", liqPrice: "99000" },
    { totalEquity: "120.5", totalAvailableBalance: "80" },
  );
  expect(short.positionSz).toBe(-0.002);
  expect(short.entryPrice).toBe(85000);
  expect(short.unrealizedUsd).toBe(-1.5);
  expect(short.leverage).toBe(5);
  expect(short.liquidationPx).toBe(99000);
  expect(short.accountValue).toBe(120.5);
  expect(short.withdrawable).toBe(80);
  const flat = accountFromBybit({ symbol: "BTCUSDT", side: "", size: "0", avgPrice: "0", liqPrice: "" }, null, short);
  expect(flat.positionSz).toBe(0);
  expect(flat.entryPrice).toBe(null);
  expect(flat.liquidationPx).toBe(null);
  expect(flat.accountValue).toBe(120.5);
});

test("fill dir comes from closedSize", () => {
  expect(bybitFillDir({ execQty: "0.001", closedSize: "0" })).toBe("open");
  expect(bybitFillDir({ execQty: "0.001", closedSize: "0.001" })).toBe("close");
  expect(bybitFillDir({ execQty: "0.003", closedSize: "0.001" })).toBe("flip");
});

test("Bybit keys: per-coin sub-accounts, first coin can use BYBIT_API_KEY", () => {
  const keys = parseBybitKeysJson('{"sleeves":[{"coin":"ETH","apiKey":"k","apiSecret":"s"},{"coin":"SOL","apiKey":"x"}]}');
  expect(keys.get("ETH")).toEqual({ apiKey: "k", apiSecret: "s" });
  expect(keys.has("SOL")).toBe(false);
  expect(parseBybitKeysJson("not json").size).toBe(0);

  const saved = { ...process.env };
  process.env.COINS = "BTC,ETH,SOL";
  process.env.BYBIT_API_KEY = "bk";
  process.env.BYBIT_API_SECRET = "bs";
  process.env.BYBIT_KEYS_JSON = '{"sleeves":[{"coin":"ETH","apiKey":"ek","apiSecret":"es"}]}';
  try {
    const sleeves = loadSleeves();
    expect(sleeves.map((s) => s.pair)).toEqual(["BTC-USDT", "ETH-USDT", "SOL-USDT"]);
    expect(sleeves[0]!.bybit).toEqual({ apiKey: "bk", apiSecret: "bs" });
    expect(sleeves[1]!.bybit).toEqual({ apiKey: "ek", apiSecret: "es" });
    expect(sleeves[2]!.bybit).toBeUndefined();
    expect(sleeves.map(hasKeys)).toEqual([true, true, false]);
  } finally {
    for (const k of ["COINS", "BYBIT_API_KEY", "BYBIT_API_SECRET", "BYBIT_KEYS_JSON"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
