import { expect, test } from "bun:test";
import { crosshairLabel, tickLabel, zonedDateTime } from "../web/src/lib/chartTime";
import { backtestDetail, backtestLots, backtestMarks, fmtHeld, fmtSize, lotSummary, parseBacktest, roePct } from "../web/src/lib/backtest";
import { fmtDateTime } from "../web/src/lib/format";
import type { BacktestTrade } from "../src/types";

const H = 60 * 60 * 1000;
const trade = (t: Partial<BacktestTrade>): BacktestTrade => ({
  side: "short", entryTs: 0, entryPx: 100, exitTs: null, exitPx: 100, size: 1, pnlUsd: 0, feesUsd: 0, maxAdversePct: 0, ...t,
});

test("backtestMarks puts entry and exit on the view's bars, with the PnL on the exit", () => {
  const times = new Set([0, 3600, 7200]);
  const marks = backtestMarks([trade({ entryTs: 10 * 60_000, exitTs: 2 * H + 5 * 60_000, pnlUsd: -13.586 })], "1H", times);
  expect(marks.map(({ trade: _, ...m }) => m)).toEqual([
    { time: 0, kind: "entry", side: "short", text: "BT Short 1" },
    { time: 7200, kind: "exit", side: "short", text: "BT -$13.59", win: false },
  ]);
});

test("backtestMarks marks an open trade and drops bars the chart does not have", () => {
  const marks = backtestMarks([
    trade({ side: "long", entryTs: H, pnlUsd: 1.2 }),
    trade({ entryTs: 50 * H, exitTs: 51 * H, pnlUsd: 1 }),
  ], "1H", new Set([3600]));
  expect(marks).toHaveLength(1);
  expect(marks[0]).toMatchObject({ time: 3600, kind: "entry", side: "long", text: "BT Long 1 open" });
  expect(backtestMarks([trade({ entryTs: 0, exitTs: H, pnlUsd: 1.256 })], "1D", new Set([0]))[1]!.text).toBe("BT +$1.26");
});

test("parseBacktest rejects anything without trades", () => {
  expect(parseBacktest(null)).toBeNull();
  expect(parseBacktest({ error: "no backtest yet" })).toBeNull();
  expect(parseBacktest({ from: 1, to: 2, tradesByCoin: { BTC: [] } })?.tradesByCoin).toEqual({ BTC: [] });
});

test("backtestLots lists closed trades for the coins in scope, PnL before fees like the bot's lots", () => {
  const report = {
    from: 0, to: 1, ranAt: 1, quoteUsd: 40, leverageByCoin: {},
    tradesByCoin: {
      BTC: [trade({ entryTs: 1, exitTs: 2, entryPx: 100, exitPx: 95, pnlUsd: 4.9, feesUsd: 0.1 }), trade({ entryTs: 3 })],
      ETH: [trade({ side: "long", entryTs: 5, exitTs: 6, pnlUsd: -1.2, feesUsd: 0.05 })],
    },
  };
  const btc = backtestLots(report, ["BTC"]);
  expect(btc).toHaveLength(1); // the open trade is left out
  expect(btc[0]).toMatchObject({ coin: "BTC", ts: 2, openedTs: 1, side: "short", entry: 100, exit: 95, fee: 0.1 });
  expect(btc[0]!.pnl).toBeCloseTo(5, 9);
  expect(backtestLots(report, ["BTC", "ETH"])).toHaveLength(2);
  expect(backtestLots(null, ["BTC"])).toEqual([]);
  const sum = lotSummary(backtestLots(report, ["BTC", "ETH"]));
  expect(sum.trades).toBe(2);
  expect(sum.wins).toBe(1);
  expect(sum.netUsd).toBeCloseTo(4.9 - 1.2, 9);
});

test("fmtDateTime shows month, day, and clock", () => {
  expect(fmtDateTime(new Date(2026, 6, 9, 4, 37).getTime())).toBe("07/09 04:37");
  expect(fmtDateTime(null)).toBe("--/-- --:--");
});

test("backtest hover card shows size, leverage, ROE, and hold time", () => {
  const t = trade({ side: "long", size: 0.0010000001, entryPx: 60000, exitTs: 26 * H + 30 * 60_000, exitPx: 61000, pnlUsd: 0.9, feesUsd: 0.05, maxAdversePct: 1.234 });
  expect(fmtSize(t.size)).toBe("0.001");
  expect(roePct(t, 15)).toBeCloseTo(22.5, 4); // 0.9 on $4 margin
  expect(fmtHeld(26 * H + 30 * 60_000)).toBe("1d 2h");
  expect(fmtHeld(45 * 60_000)).toBe("45m");
  const d = backtestDetail(t, "BTC", 15);
  expect(d.title).toBe("BT Long BTC");
  const row = (l: string) => d.rows.find((r) => r.label === l);
  expect(row("Size")?.value).toBe("0.001 BTC 15x");
  expect(row("PnL")).toEqual({ label: "PnL", value: "+$0.90  ROE +22.5%", tone: "win" });
  expect(row("Held")?.value).toBe("1d 2h");
  expect(row("Max adverse")?.value).toBe("1.23%");
  const open = backtestDetail(trade({ pnlUsd: -0.2 }), "ETH", 15);
  expect(open.rows.find((r) => r.label === "PnL")?.tone).toBe("loss");
  expect(open.rows.find((r) => r.label === "Held")).toBeUndefined();
});

test("chart clock labels shift UTC bars to UTC+9 without moving them", () => {
  const sec = Date.UTC(2026, 9, 14, 20, 0, 5) / 1000; // 2026-10-14 20:00:05 UTC
  expect(crosshairLabel(sec, 9)).toBe("2026-10-15 05:00");
  expect(crosshairLabel(sec, 0, true)).toBe("2026-10-14 20:00:05");
  expect(tickLabel(sec, 3, 9)).toBe("05:00");
  expect(tickLabel(sec, 2, 9)).toBe("15일");
  expect(tickLabel(sec, 1, 0)).toBe("10월");
  expect(zonedDateTime(sec * 1000, 9)).toBe("10/15 05:00");
  const t = trade({ entryTs: sec * 1000, exitTs: sec * 1000 + H });
  expect(backtestDetail(t, "BTC", 15, (ms) => zonedDateTime(ms, 9)).rows.find((r) => r.label === "Entry")?.value).toBe("10/15 05:00  100.00");
});
