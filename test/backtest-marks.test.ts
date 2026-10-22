import { expect, test } from "bun:test";
import { crosshairLabel, tickLabel, zonedDateTime } from "../web/src/lib/chartTime";
import { backtestDetail, backtestLots, backtestMarks, backtestOpenPnl, fmtHeld, fmtSize, lotSummary, parseBacktest, roePct } from "../web/src/lib/backtest";
import { fmtCall, fmtDateTime } from "../web/src/lib/format";
import { closedLots, withBalance } from "../web/src/lib/fills";
import type { BacktestTrade } from "../src/types";

const H = 60 * 60 * 1000;
const trade = (t: Partial<BacktestTrade>): BacktestTrade => ({
  side: "short", entryTs: 0, entryPx: 100, exitTs: null, exitPx: 100, size: 1, pnlUsd: 0, feesUsd: 0, maxAdversePct: 0, ...t,
});

test("backtestMarks puts entry and exit on the view's bars, with the PnL on the exit", () => {
  const times = new Set([0, 3600, 7200]);
  const marks = backtestMarks([trade({ entryTs: 10 * 60_000, exitTs: 2 * H + 5 * 60_000, pnlUsd: -13.586 })], "1H", times);
  expect(marks.map(({ trade: _, ...m }) => m)).toEqual([
    { time: 0, kind: "entry", side: "short", text: "BT 숏 1" },
    { time: 7200, kind: "exit", side: "short", text: "BT -$13.59", win: false },
  ]);
});

test("backtestMarks marks an open trade and drops bars the chart does not have", () => {
  const marks = backtestMarks([
    trade({ side: "long", entryTs: H, pnlUsd: 1.2 }),
    trade({ entryTs: 50 * H, exitTs: 51 * H, pnlUsd: 1 }),
  ], "1H", new Set([3600]));
  expect(marks).toHaveLength(1);
  expect(marks[0]).toMatchObject({ time: 3600, kind: "entry", side: "long", text: "BT 롱 1 보유중" });
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
  expect(fmtDateTime(new Date(2026, 6, 9, 4, 37).getTime())).toBe("07.09 04:37");
  expect(fmtDateTime(null)).toBe("--.-- --:--");
});

test("backtest hover card shows size, leverage, ROE, and hold time", () => {
  const t = trade({ side: "long", size: 0.0010000001, entryPx: 60000, exitTs: 26 * H + 30 * 60_000, exitPx: 61000, pnlUsd: 0.9, feesUsd: 0.05, maxAdversePct: 1.234 });
  expect(fmtSize(t.size)).toBe("0.001");
  expect(roePct(t, 15)).toBeCloseTo(22.5, 4); // 0.9 on $4 margin
  expect(fmtHeld(26 * H + 30 * 60_000)).toBe("1일 2시간");
  expect(fmtHeld(45 * 60_000)).toBe("45분");
  const d = backtestDetail(t, "BTC", 15);
  expect(d.title).toBe("BT 롱 BTC");
  const row = (l: string) => d.rows.find((r) => r.label === l);
  expect(row("수량")?.value).toBe("0.001 BTC 15x");
  expect(row("손익")).toEqual({ label: "손익", value: "+$0.90  수익률 +22.5%", tone: "win" });
  expect(row("보유")?.value).toBe("1일 2시간");
  expect(row("최대 역행")?.value).toBe("1.23%");
  const open = backtestDetail(trade({ pnlUsd: -0.2 }), "ETH", 15);
  expect(open.rows.find((r) => r.label === "손익")?.tone).toBe("loss");
  expect(open.rows.find((r) => r.label === "보유")).toBeUndefined();
});

test("chart clock labels shift UTC bars to UTC+9 without moving them", () => {
  const sec = Date.UTC(2026, 9, 14, 20, 0, 5) / 1000; // 2026-10-14 20:00:05 UTC
  expect(crosshairLabel(sec, 9)).toBe("2026.10.15 05:00");
  expect(crosshairLabel(sec, 0, true)).toBe("2026.10.14 20:00:05");
  expect(tickLabel(sec, 3, 9)).toBe("05:00");
  expect(tickLabel(sec, 2, 9)).toBe("15일");
  expect(tickLabel(sec, 1, 0)).toBe("10월");
  expect(zonedDateTime(sec * 1000, 9)).toBe("10.15 05:00");
  const t = trade({ entryTs: sec * 1000, exitTs: sec * 1000 + H });
  expect(backtestDetail(t, "BTC", 15, (ms) => zonedDateTime(ms, 9)).rows.find((r) => r.label === "진입")?.value).toBe("10.15 05:00  100.00");
});

test("a trade with adds marks each entry with its round, and the card lists them with the average", () => {
  const t = trade({
    side: "long", entryTs: 0, entryPx: 95, exitTs: 3 * H, exitPx: 99, size: 2, pnlUsd: 8,
    entries: [{ ts: 0, px: 100, size: 1 }, { ts: H, px: 90, size: 1 }],
  });
  const marks = backtestMarks([t], "1H", new Set([0, 3600, 7200, 10800]));
  expect(marks.map((m) => m.text)).toEqual(["BT 롱 1", "BT 롱 2차 1", "BT +$8.00"]);
  const d = backtestDetail(t, "BTC", 10, (ms) => zonedDateTime(ms, 0));
  expect(d.rows.find((r) => r.label === "1차 진입")?.value).toBe("01.01 00:00  100.00");
  expect(d.rows.find((r) => r.label === "2차 진입")?.value).toBe("01.01 01:00  90.0000");
  expect(d.rows.find((r) => r.label === "평균가")?.value).toBe("95.0000");
  expect(d.rows.find((r) => r.label === "진입")).toBeUndefined();
});

test("backtestOpenPnl marks open trades at the live price, after the entry fee, and skips closed ones", () => {
  const report = {
    from: 0, to: 1, ranAt: 1, quoteUsd: 40, leverageByCoin: {},
    tradesByCoin: {
      BTC: [trade({ side: "short", entryPx: 100, size: 2, feesUsd: 0.1, pnlUsd: 3 })],
      ETH: [trade({ side: "long", entryPx: 50, size: 1, feesUsd: 0.05, pnlUsd: -0.5 })],
      SOL: [trade({ exitTs: 5, pnlUsd: 9 })],
    },
  };
  // BTC short at 100 marked at 98: +4 - 0.1. ETH has no price: keeps -0.5.
  expect(backtestOpenPnl(report, { BTC: 98, ETH: null })).toBeCloseTo(3.9 - 0.5, 9);
  expect(backtestOpenPnl({ ...report, tradesByCoin: { SOL: report.tradesByCoin.SOL } }, {})).toBeNull();
  expect(backtestOpenPnl(null, {})).toBeNull();
});

test("a partial take profit marks only its exit, and the rest keeps the size it opened with", () => {
  const entries = [{ ts: 0, px: 100, size: 1 }];
  const part = trade({ side: "long", entryTs: 0, exitTs: H, size: 0.7, pnlUsd: 0.7, partial: true, entries });
  const rest = trade({ side: "long", entryTs: 0, exitTs: 2 * H, size: 0.3, pnlUsd: 0.6, entries });
  const marks = backtestMarks([part, rest], "1H", new Set([0, 3600, 7200]));
  expect(marks.map((m) => m.text)).toEqual(["BT 롱 1", "BT 부분 +$0.70", "BT +$0.60"]);
  expect(backtestDetail(part, "BTC", 10).rows.some((r) => r.label === "부분 익절")).toBe(true);
});

test("fmtCall names a partial take profit with its share", () => {
  expect(fmtCall({ intent: "close", bias: "long", leverage: 15, closeFraction: 0.7 })).toBe("롱 70% 익절 15x");
  expect(fmtCall({ intent: "close", bias: "short", leverage: 15 })).toBe("숏 청산 15x");
});

test("withBalance runs the balance oldest first and keeps the given order", () => {
  const rows = [
    { key: "b", ts: 20, pnl: -3, fee: 0.5 },
    { key: "a", ts: 10, pnl: 5, fee: 1 },
  ];
  const out = withBalance(rows, 100);
  expect(out.map((r) => r.key)).toEqual(["b", "a"]);
  expect(out[1]!.balance).toBeCloseTo(104, 9);   // 100 + 5 - 1
  expect(out[0]!.balance).toBeCloseTo(100.5, 9); // then - 3 - 0.5
});

test("a re-entry after the first-price take profit is marked with its own round", () => {
  const t = trade({
    side: "long", entryTs: 0, exitTs: null, size: 1,
    entries: [{ ts: 0, px: 100, size: 1 }, { ts: H, px: 99, size: 1 }, { ts: 2 * H, px: 98, size: 1 }, { ts: 3 * H, px: 99, size: 1, round: 2 }],
  });
  const marks = backtestMarks([t], "1H", new Set([0, 3600, 7200, 10800]));
  expect(marks.map((m) => m.text)).toEqual(["BT 롱 1 보유중", "BT 롱 2차 1 보유중", "BT 롱 3차 1 보유중", "BT 롱 2차 1 보유중"]);
  const labels = backtestDetail(t, "BTC", 5).rows.map((r) => r.label);
  expect(labels).toContain("2차 재진입");
  expect(labels).toContain("3차 진입");
});

test("history picks up a carried position: its close is a lot with the backtest's entry and entry fee", () => {
  const carried = { side: "short" as const, size: 0.003, entryPx: 83000, entryTs: 1_000, feesUsd: 0.06 };
  const fills = [
    { key: "a", ts: 5_000, side: "sell" as const, price: 84000, size: 0.003, dir: "open" as const, feeUsd: 0.05 },
    { key: "b", ts: 9_000, side: "buy" as const, price: 82000, size: 0.006, dir: "close" as const, feeUsd: 0.1 },
  ];
  const lots = closedLots(fills, carried);
  expect(lots).toHaveLength(1);
  expect(lots[0]).toMatchObject({ side: "short", size: 0.006, openedTs: 1_000, entry: 83500 });
  expect(lots[0]!.pnl).toBeCloseTo((83500 - 82000) * 0.006, 6);
  expect(lots[0]!.fee).toBeCloseTo(0.16, 9); // the close fee plus the carried entry fee
  expect(closedLots(fills.slice(1))).toHaveLength(0); // without it, a close of nothing
});

test("backtestOpenPnl leaves out a coin the dry run carried on", () => {
  const report = {
    from: 0, to: 1, ranAt: 1, quoteUsd: 40, leverageByCoin: {},
    tradesByCoin: { BTC: [trade({ side: "short", entryPx: 100, size: 2, feesUsd: 0.1 })] },
  };
  expect(backtestOpenPnl(report, { BTC: 98 })).toBeCloseTo(3.9, 9);
  expect(backtestOpenPnl(report, { BTC: 98 }, new Set(["BTC"]))).toBeNull();
});
