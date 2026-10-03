import { expect, test } from "bun:test";
import { coinPair, loadSleeves, sameCoin } from "../src/sleeves";

test("coinPair is the USDT perp name", () => {
  expect(coinPair("BTC")).toBe("BTC-USDT");
  expect(coinPair("ETH")).toBe("ETH-USDT");
});

test("sameCoin is exact", () => {
  expect(sameCoin("BTC", "BTC")).toBe(true);
  expect(sameCoin("BTC", "ETH")).toBe(false);
  expect(sameCoin(undefined, "BTC")).toBe(false);
});

test("loadSleeves follows COINS", () => {
  const prev = process.env.COINS;
  process.env.COINS = "BTC,ETH";
  try {
    const sleeves = loadSleeves();
    expect(sleeves.map((s) => s.coin)).toEqual(["BTC", "ETH"]);
    expect(sleeves[1]!.pair).toBe("ETH-USDT");
  } finally {
    if (prev == null) delete process.env.COINS;
    else process.env.COINS = prev;
  }
});
