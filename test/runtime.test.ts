import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { readRuntime, resolveDryRun, tokenMatches, writeRuntime } from "../src/runtime";

const FILE = `${import.meta.dir}/.runtime.test.json`;
afterEach(() => rmSync(FILE, { force: true }));

test("the dashboard switch overrides DRY_RUN once it was used", () => {
  expect(resolveDryRun("true", {})).toBe(true);
  expect(resolveDryRun("false", {})).toBe(false);
  expect(resolveDryRun(undefined, {})).toBe(false);
  expect(resolveDryRun("true", { dryRun: false })).toBe(false);
  expect(resolveDryRun("false", { dryRun: true })).toBe(true);
});

test("the switch survives a restart through the runtime file", () => {
  expect(readRuntime(FILE)).toEqual({});
  writeRuntime({ dryRun: true }, FILE);
  expect(readRuntime(FILE)).toEqual({ dryRun: true });
  writeRuntime({ dryRun: false }, FILE);
  expect(readRuntime(FILE)).toEqual({ dryRun: false });
});

test("a junk runtime file reads as unset", async () => {
  await Bun.write(FILE, "{not json");
  expect(readRuntime(FILE)).toEqual({});
  await Bun.write(FILE, JSON.stringify({ dryRun: "yes" }));
  expect(readRuntime(FILE)).toEqual({});
});

test("the admin password must match, and an unset one never does", () => {
  expect(tokenMatches("secret", "secret")).toBe(true);
  expect(tokenMatches("secret", "secreT")).toBe(false);
  expect(tokenMatches("secret", "")).toBe(false);
  expect(tokenMatches("secret", null)).toBe(false);
  expect(tokenMatches("", "")).toBe(false);
  expect(tokenMatches("", "anything")).toBe(false);
});

test("BACKTEST_FROM reads a date as 00:00 KST, a full time as written, and empty as the rolling 3 months", async () => {
  const { resolveBacktestFrom } = await import("../src/config");
  const now = Date.UTC(2026, 9, 25);
  expect(resolveBacktestFrom(undefined, now)).toBeNull();
  expect(resolveBacktestFrom(" ", now)).toBeNull();
  expect(resolveBacktestFrom("2026-07-01", now)).toBe(Date.UTC(2026, 5, 30, 15));
  expect(resolveBacktestFrom("2026-07-01T00:00:00Z", now)).toBe(Date.UTC(2026, 6, 1));
  expect(() => resolveBacktestFrom("july", now)).toThrow("BACKTEST_FROM");
  expect(() => resolveBacktestFrom("2026-11-01", now)).toThrow("not in the past");
});
