import { expect, test } from "bun:test";
import { FillPnlBook } from "../src/account";
import { accountFromBybit } from "../src/bybit-market";

test("FillPnlBook sums closedPnl and fees once per execution", () => {
  const book = new FillPnlBook();
  expect(book.add({ coin: "BTC", hash: "e1", tid: "e1", closedPnl: "2.5", fee: "0.1" }, "BTC")).toBe(true);
  expect(book.add({ coin: "BTC", hash: "e1", tid: "e1", closedPnl: "2.5", fee: "0.1" }, "BTC")).toBe(false);
  expect(book.add({ coin: "ETH", hash: "e2", tid: "e2", closedPnl: "9", fee: "1" }, "BTC")).toBe(false);
  expect(book.add({ coin: "BTC", hash: "e3", tid: "e3", closedPnl: "-0.4", fee: "0.05" }, "BTC")).toBe(true);
  expect(book.realized).toBeCloseTo(2.1, 8);
  expect(book.fees).toBeCloseTo(0.15, 8);
  const a = book.apply(accountFromBybit({ side: "Sell", size: "0.007", avgPrice: "77180", unrealisedPnl: "-1.23" }, null));
  expect(a.realizedUsd).toBeCloseTo(2.1, 8);
  expect(a.unrealizedUsd).toBeCloseTo(-1.23, 6);
});
