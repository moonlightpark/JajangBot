import { afterEach, expect, test } from "bun:test";
import { orderSize, runBacktest, type BacktestOpts } from "../src/backtest";
import { slipBps } from "../src/book";
import type { Ohlc } from "../src/chart";
import { config } from "../src/config";
import { buildDailyReport, kstDate, nextReportAt, type DailyMark } from "../src/daily";
import type { Model, ModelDecision } from "../src/model";
import { entryBudgetUsd, leverageRoomUsd, riskCheck, riskStopPrice, volumeRatio } from "../src/risk";
import { Trader } from "../src/trader";
import type { BlockEvent, Book, Fill, Quote, Side } from "../src/types";
import type { VenueMarket } from "../src/venue";

const M = 60_000;
const WARM = 130 * 15;
const calm = (n: number, from = 0, turnover = 1000): Ohlc[] =>
  Array.from({ length: n }, (_, i) => ({ ts: from + i * M, open: 100, high: 100.2, low: 99.8, close: 100, turnover }));
const bar = (ts: number, b: Partial<Ohlc>): Ohlc => ({ ts, open: 100, high: 100.2, low: 99.8, close: 100, turnover: 1000, ...b });
const dip = (ts: number, px: number) => [bar(ts, { low: px - 0.5, close: px }), bar(ts + M, { low: px - 0.5, close: px })];
const opts: BacktestOpts = {
  startTs: 0, leverage: 5, quoteUsd: 40, qtyStep: 0.001, minQty: 0.001, minNotional: 5, makerFee: 0.0002, takerFee: 0.00055,
};

test("the hard stop sits the set percent past the average entry", () => {
  expect(riskStopPrice("long", 100, 5)).toBeCloseTo(95, 9);
  expect(riskStopPrice("short", 100, 5)).toBeCloseTo(105, 9);
  expect(riskStopPrice("long", 100, null)).toBeNull();
  const rules = { stopPct: 5, volumeRatio: null };
  expect(riskCheck(rules, { side: "long", entryPx: 100 }, 95.1, null)).toBeNull();
  expect(riskCheck(rules, { side: "long", entryPx: 100 }, 95, null)).toMatchObject({ rule: "stop" });
  expect(riskCheck(rules, { side: "short", entryPx: 100 }, 105, null)).toMatchObject({ rule: "stop" });
  expect(riskCheck({ stopPct: null, volumeRatio: null }, { side: "long", entryPx: 100 }, 1, [])).toBeNull();
});

test("the volume rule reads 6h turnover against the 24h average per 6h, and waits for a full day", () => {
  expect(volumeRatio(Array(95).fill(10))).toBeNull();
  expect(volumeRatio(Array(96).fill(10))).toBeCloseTo(1, 9);
  // 4.7k in 24h, 167.75 in the last 6h: the guide's example, 0.142.
  const day = [...Array(72).fill((4717.7 - 167.75) / 72), ...Array(24).fill(167.75 / 24)];
  expect(volumeRatio(day)).toBeCloseTo(0.1422, 3);
  expect(riskCheck({ stopPct: null, volumeRatio: 0.2 }, { side: "long", entryPx: 100 }, 100, day)).toMatchObject({ rule: "volume" });
  expect(riskCheck({ stopPct: null, volumeRatio: 0.1 }, { side: "long", entryPx: 100 }, 100, day)).toBeNull();
  expect(volumeRatio([...Array(95).fill(10), Number.NaN])).toBeNull();
});

test("slippage is positive when the fill cost us", () => {
  expect(slipBps("buy", 100.1, 100)).toBe(10);
  expect(slipBps("sell", 99.9, 100)).toBe(10);
  expect(slipBps("buy", 99.95, 100)).toBe(-5);
  expect(slipBps("buy", 100, 0)).toBeNull();
});

test("MAX_ACCOUNT_LEVERAGE leaves room up to N times the balance, and the order shrinks to fit", () => {
  expect(leverageRoomUsd(null, 10_000, 5_000)).toBe(Infinity);
  expect(leverageRoomUsd(1, 10_000, 9_400)).toBe(600);
  expect(leverageRoomUsd(1, 10_000, 12_000)).toBe(0);
  expect(leverageRoomUsd(2, 10_000, 5_000)).toBe(15_000);
  expect(orderSize(100, { ...opts, quoteUsd: 800 }, 600)).toBe(6);
  expect(orderSize(100, { ...opts, quoteUsd: 800 }, 5_000)).toBe(8);
  expect(orderSize(100, { ...opts, quoteUsd: 800 })).toBe(8);
  // $3 of room is under the $5 minimum: no order, not a minimum order past the cap.
  expect(orderSize(100, { ...opts, quoteUsd: 800 }, 3)).toBe(0);
  // No cap: a small QUOTE_USD still rounds up to the minimum, as before.
  expect(orderSize(100, { ...opts, quoteUsd: 1 })).toBe(0.05);
});

test("the backtest's hard stop closes at the stop price and that side waits", () => {
  const t0 = WARM * M;
  const rows = [
    ...calm(WARM),
    ...dip(t0, 98),                                 // long at 98
    ...calm(5, t0 + 2 * M),
    bar(t0 + 7 * M, { low: 92, close: 92.5 }),      // through the 5% stop at 93.1
    ...Array.from({ length: 10 }, (_, i) => bar(t0 + (8 + i) * M, { low: 92, close: 92.5 })), // still a long signal
  ];
  const r = runBacktest(rows, { ...opts, riskStopPct: 5 });
  expect(r.riskCloses).toBe(1);
  expect(r.trades).toHaveLength(1);
  expect(r.trades[0]).toMatchObject({ side: "long", entryPx: 98, risk: "stop" });
  expect(r.trades[0]!.exitPx).toBeCloseTo(98 * 0.95, 9);
  expect(runBacktest(rows, opts).riskCloses).toBe(0);
});

test("the backtest's volume rule closes once 6h turnover dries up", () => {
  const t0 = WARM * M;
  const rows = [...calm(WARM), ...dip(t0, 98), ...calm(400, t0 + 2 * M, 0)];
  const r = runBacktest(rows, { ...opts, riskVolumeRatio: 0.2 });
  expect(r.riskCloses).toBe(1);
  expect(r.trades[0]).toMatchObject({ side: "long", risk: "volume" });
  // About 304 dry minutes before 6h falls under 20% of the daily average per 6h.
  const after = (r.trades[0]!.exitTs! - (t0 + 2 * M)) / M;
  expect(after).toBeGreaterThan(290);
  expect(after).toBeLessThan(330);
});

test("MAX_ACCOUNT_LEVERAGE sizes every entry as its share of the cap, from the first one", () => {
  expect(entryBudgetUsd(null, 10_000, 3)).toBeNull();
  expect(entryBudgetUsd(2, 10_000, 3)).toBeCloseTo(6666.67, 2);
  expect(entryBudgetUsd(2, 10_000, 1)).toBe(20_000);
  const t0 = WARM * M;
  const rows = [
    ...calm(WARM),
    ...dip(t0, 98),                 // entry 1
    ...calm(20, t0 + 2 * M),
    ...dip(t0 + 22 * M, 97.5),      // entry 2
    ...calm(20, t0 + 24 * M),
    ...dip(t0 + 44 * M, 97),        // entry 3
    bar(t0 + 46 * M, { close: 97.6 }),
  ];
  // 0.6x of $100 is $60 for three entries: about $20 each, QUOTE_USD ($40) set aside.
  const r = runBacktest(rows, { ...opts, maxAdds: 2, addGapBars: [1], maxAccountLeverage: 0.6, bankrollUsd: 100 });
  const entries = r.open!.entries!;
  expect(entries).toHaveLength(3);
  for (const e of entries) expect(e.size * e.px).toBeLessThanOrEqual(20 + 1e-9);
  expect(entries[0]!.size).toBe(0.204);
  expect(entries.reduce((n, e) => n + e.size * e.px, 0)).toBeLessThanOrEqual(60);
  // No cap: QUOTE_USD sizes, as before.
  const free = runBacktest(rows, { ...opts, maxAdds: 2, addGapBars: [1] });
  expect(free.open!.entries![0]!.size).toBe(0.408);
});

test("the daily report closes at the set KST hour and adds up the day", () => {
  const at = nextReportAt(Date.UTC(2026, 9, 25, 13, 0), 23); // 22:00 KST
  expect(at).toBe(Date.UTC(2026, 9, 25, 14, 0));
  expect(nextReportAt(at, 23)).toBe(at + 86_400_000);
  expect(kstDate(at)).toBe("2026-10-25");
  const start: DailyMark = { at: at - 86_400_000, equityUsd: 10_000, realizedUsd: 5, feesUsd: 1, position: null };
  const end: DailyMark = { at, equityUsd: 10_050, realizedUsd: 60, feesUsd: 3, position: { side: "long", size: 0.01, entryPx: 80000, mid: 80100 } };
  const fill = (ts: number, f: Partial<Fill>): { ts: number; fill: Fill } => ({
    ts, fill: { side: "buy", size: 0.01, price: 80000, txHash: null, orderId: 1, simulated: true, ...f },
  });
  const r = buildDailyReport("BTC", start, end, [
    fill(start.at - 1, { slipBps: 99 }),              // the day before: left out
    fill(start.at + 1, { dir: "open", slipBps: 1 }),
    fill(start.at + 2, { side: "sell", dir: "close", slipBps: 3, risk: "stop" }),
  ], false);
  expect(r).toMatchObject({
    coin: "BTC", date: "2026-10-25", startBalance: 10_000, endBalance: 10_050, pnlUsd: 50, pnlPct: 0.5,
    realizedUsd: 55, feesUsd: 2, entries: 1, closes: 1, riskCloses: 1, avgSlipBps: 2, maxSlipBps: 3,
    open: { side: "long", size: 0.01, entryPx: 80000 },
  });
  expect(r.sinceStart).toBeUndefined();
});

const book: Book = {
  block: 1, bid: 99.9, ask: 100.1, mid: 100, spreadBps: 20, imbalance: 0,
  levels: { bids: [[99.9, 1]], asks: [[100.1, 1]] }, depthBps: { "10": { bid: 1, ask: 1 } },
};

class Market {
  readonly coin = "BTC";
  readonly pair = "BTC-USDT";
  readonly label = "BTC";
  readonly wallet = null;
  readonly account = null;
  readonly szDecimals = 5;
  readonly maxLeverage = 40;
  readonly fillPrints: [] = [];
  assetCtx = null;
  bookAt = Date.now();
  mid = 100;
  sent: { side: Side; size: number; taker: boolean; risk?: string }[] = [];
  candleCloses() { return []; }
  bars() { return []; }
  refresh() { return Promise.resolve(); }
  readBook() { return { ...book, mid: this.mid, bid: this.mid - 0.1, ask: this.mid + 0.1 }; }
  quoteSize() { return 0.01; }
  setLeverage(n: number) { return Promise.resolve(n); }
  async send(side: Side, size: number, b: Book, cancel: number[], reduceOnly = false, taker = false, risk?: string): Promise<Quote> {
    this.sent.push({ side, size, taker, ...(risk ? { risk } : {}) });
    return { side, price: taker ? b.mid - 0.1 : b.mid, size, txHash: null, cancel, status: "sim", orderId: null, capped: false, reduceOnly, taker };
  }
  async cancelResting() { return []; }
}

const saved = { stop: config.riskStopPct, volume: config.riskVolumeRatio };
afterEach(() => {
  config.riskStopPct = saved.stop;
  config.riskVolumeRatio = saved.volume;
});

test("the watchdog closes the whole position on its own timer, tags the fill, and tells the model", async () => {
  config.riskStopPct = 5;
  config.riskVolumeRatio = null;
  const closed: string[] = [];
  const model: Model = {
    name: "script",
    async decide(): Promise<ModelDecision> { throw new Error("not on this path"); },
    riskClosed(side) { closed.push(side); },
  };
  const market = new Market();
  const events: BlockEvent[] = [];
  const fills: Fill[] = [];
  const trader = new Trader(market as unknown as VenueMarket, model, (e) => events.push(e), (_b, f) => fills.push(f));
  trader.carry({ side: "long", size: 0.02, entryPx: 100, feesUsd: 0, entryTs: 1, count: 1, lastTs: 1, firstPx: 100 });
  let block = 10;
  market.mid = 96;
  await trader.riskTick(() => ++block);
  expect(market.sent).toHaveLength(0);
  market.mid = 94.9;
  await trader.riskTick(() => ++block);
  await Bun.sleep(5);
  expect(market.sent).toEqual([{ side: "sell", size: 0.02, taker: true, risk: "stop" }]);
  expect(closed).toEqual(["long"]);
  const e = events.find((x) => x.block === 11)!;
  expect(e.decision).toMatchObject({ intent: "close", risk: { rule: "stop" } });
  expect(fills[0]).toMatchObject({ side: "sell", size: 0.02, risk: "stop", dir: "close", refPx: 94.9 });
  expect(fills[0]!.slipBps).toBeCloseTo(((94.9 - 94.8) / 94.9) * 10_000, 1);
  expect(trader.ledger).toHaveLength(1);
  // Flat now: nothing more to close.
  await trader.riskTick(() => ++block);
  expect(market.sent).toHaveLength(1);
});

test("a stale book holds new entries but the watchdog does not guess a price", async () => {
  config.riskStopPct = 5;
  const market = new Market();
  market.bookAt = Date.now() - config.riskStaleMs - 1000;
  const model: Model = {
    name: "script",
    async decide(): Promise<ModelDecision> {
      return {
        action: "buy", intent: "open", bias: "long", leverage: 1,
        probabilities: { buy: 1, sell: 0, hold: 0, long: 1, short: 0, open: 1, close: 0 },
        upIn10: 0.5, latencyMs: 0, inputTokens: 0,
      };
    },
  };
  const trader = new Trader(market as unknown as VenueMarket, model, () => {});
  await trader.onBlock(1);
  await Bun.sleep(5);
  expect(market.sent).toHaveLength(0);
  trader.carry({ side: "long", size: 0.02, entryPx: 100, feesUsd: 0, entryTs: 1, count: 1, lastTs: 1, firstPx: 100 });
  market.mid = 90;
  await trader.riskTick(() => 2);
  expect(market.sent).toHaveLength(0);
});
