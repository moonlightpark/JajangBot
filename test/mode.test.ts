import { expect, test } from "bun:test";
import { tradingMode } from "../web/src/lib/mode";

const bybit = (network: "mainnet" | "testnet" | "demo", dryRun = false) => ({ venue: "bybit", network, dryRun });

test("no key on the sleeve is a dry run, whatever the network", () => {
  expect(tradingMode(bybit("demo"), null)).toEqual({ label: "Dry run", detail: "Bybit demo prices, simulated fills", real: false });
  expect(tradingMode(bybit("testnet"), null).detail).toBe("Bybit testnet prices, simulated fills");
  expect(tradingMode(bybit("mainnet"), null)).toEqual({ label: "Dry run", detail: "Bybit prices, simulated fills", real: false });
});

test("DRY_RUN=true wins even with a key", () => {
  expect(tradingMode(bybit("mainnet", true), "bybit:1").label).toBe("Dry run");
});

test("real orders show the network, and only mainnet is real money", () => {
  expect(tradingMode(bybit("mainnet"), "bybit:1")).toEqual({ label: "Live", detail: "Bybit mainnet", real: true });
  expect(tradingMode(bybit("testnet"), "bybit:1")).toEqual({ label: "Testnet", detail: "Bybit testnet", real: false });
  expect(tradingMode(bybit("demo"), "bybit:1")).toEqual({ label: "Demo", detail: "Bybit demo trading", real: false });
});
