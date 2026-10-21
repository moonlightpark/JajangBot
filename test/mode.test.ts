import { expect, test } from "bun:test";
import { deciderLabel, tradingMode } from "../web/src/lib/mode";

const bybit = (network: "mainnet" | "testnet" | "demo", dryRun = false) => ({ venue: "bybit", network, dryRun });

test("no key on the sleeve is a dry run, whatever the network", () => {
  expect(tradingMode(bybit("demo"), null)).toEqual({ label: "모의거래", detail: "Bybit 데모 시세, 가상 체결", real: false });
  expect(tradingMode(bybit("testnet"), null).detail).toBe("Bybit 테스트넷 시세, 가상 체결");
  expect(tradingMode(bybit("mainnet"), null)).toEqual({ label: "모의거래", detail: "Bybit 시세, 가상 체결", real: false });
});

test("DRY_RUN=true wins even with a key", () => {
  expect(tradingMode(bybit("mainnet", true), "bybit:1").label).toBe("모의거래");
});

test("real orders show the network, and only mainnet is real money", () => {
  expect(tradingMode(bybit("mainnet"), "bybit:1")).toEqual({ label: "실거래", detail: "Bybit 메인넷", real: true });
  expect(tradingMode(bybit("testnet"), "bybit:1")).toEqual({ label: "테스트넷", detail: "Bybit 테스트넷", real: false });
  expect(tradingMode(bybit("demo"), "bybit:1")).toEqual({ label: "데모", detail: "Bybit 데모 트레이딩", real: false });
});

test("the header names who decides, so a strategy call never reads as Jev's", () => {
  expect(deciderLabel("jev")).toBe("Jev");
  expect(deciderLabel("strategy")).toBe("TradingView 전략");
  expect(deciderLabel("mock")).toBe("모의 모델");
});
