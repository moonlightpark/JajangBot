import { expect, test } from "bun:test";
import { focusRange } from "../web/src/lib/ohlc";

const times = Array.from({ length: 200 }, (_, i) => 1000 + i * 900);

test("focusRange centers the trade's bars, at least minBars wide", () => {
  // Entry inside bar 50, exit inside bar 60.
  expect(focusRange(times, 1000 + 50 * 900 + 10, 1000 + 60 * 900 + 10, 80)).toEqual({ from: 15, to: 95 });
});

test("focusRange widens for a long trade and waits for bars that are not loaded", () => {
  expect(focusRange(times, 1000, 1000 + 99 * 900, 80)).toEqual({ from: -25.5, to: 124.5 });
  expect(focusRange(times, 999, 2000, 80)).toBeNull();
  expect(focusRange([], 1000, 2000, 80)).toBeNull();
});
