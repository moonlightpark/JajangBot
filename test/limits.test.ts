import { expect, test } from "bun:test";
import { leverageView } from "../web/src/lib/limits";
import type { BlockEvent } from "../web/src/lib/bot-types";

const event = (accountValue: number | null, size: number, mid = 80_000) =>
  ({ mid, accountValue, position: { side: size ? "long" : "flat", size, entryPrice: 80_000, leverage: 5, unrealizedUsd: 0, unrealizedSz: 0 } }) as unknown as BlockEvent;
const risk = { stopPct: null, volumePct: null, maxAccountLeverage: 2, entries: 3, dailyHourKst: null };

test("the positions tab reads the account leverage and the room left the way the bot sizes", () => {
  const v = leverageView(event(12_000, 0.2), risk)!;
  expect(v.positionUsd).toBe(16_000);
  expect(v.leverage).toBeCloseTo(1.3333, 4);
  expect(v.limitUsd).toBe(24_000);
  expect(v.roomUsd).toBe(8_000);
  expect(v.nextOrderUsd).toBe(8_000);
  // Flat: the next order is the cap's share for one entry.
  expect(leverageView(event(12_000, 0), risk)!.nextOrderUsd).toBe(8_000);
  // Close to the cap: the next order is only what is left.
  expect(leverageView(event(12_000, 0.29), risk)!.nextOrderUsd).toBeCloseTo(800, 6);
  // No cap: leverage only.
  expect(leverageView(event(12_000, 0.2), { ...risk, maxAccountLeverage: null })).toMatchObject({ limitUsd: null, roomUsd: null, nextOrderUsd: null });
  expect(leverageView(event(null, 0.2), risk)).toBeNull();
});
