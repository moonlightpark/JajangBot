import type { Book, Side } from "./types";
import { config } from "./config";

export interface Level { px: string; sz: string }

export function bookFromLevels(block: number, bids: Level[], asks: Level[]): Book | null {
  const bidLv: [number, number][] = [];
  const askLv: [number, number][] = [];
  for (const l of bids) {
    const px = Number(l.px), sz = Number(l.sz);
    if (px > 0 && sz > 0) bidLv.push([px, sz]);
  }
  for (const l of asks) {
    const px = Number(l.px), sz = Number(l.sz);
    if (px > 0 && sz > 0) askLv.push([px, sz]);
  }
  if (!bidLv.length && askLv.length) {
    const [ask, sz] = askLv[0]!;
    bidLv.push([ask * (1 - 0.0005), sz]);
  } else if (!askLv.length && bidLv.length) {
    const [bid, sz] = bidLv[0]!;
    askLv.push([bid * (1 + 0.0005), sz]);
  }
  if (!bidLv.length || !askLv.length) return null;
  bidLv.sort((a, b) => b[0] - a[0]);
  askLv.sort((a, b) => a[0] - b[0]);
  const bid = bidLv[0]![0], ask = askLv[0]![0];
  if (!(ask > bid)) return null;
  const mid = (bid + ask) / 2;
  const spreadBps = ((ask - bid) / mid) * 10_000;
  const near = (side: [number, number][], maxBps: number) => {
    let d = 0;
    for (const [px, sz] of side) {
      const bps = Math.abs(px - mid) / mid * 10_000;
      if (bps <= maxBps) d += sz;
    }
    return d;
  };
  const bid1 = near(bidLv, 100), ask1 = near(askLv, 100);
  const tot = bid1 + ask1;
  return {
    block,
    bid,
    ask,
    mid,
    spreadBps,
    imbalance: tot > 0 ? (bid1 - ask1) / tot : 0,
    levels: { bids: bidLv.slice(0, 5), asks: askLv.slice(0, 5) },
    depthBps: {
      "10": { bid: near(bidLv, 10), ask: near(askLv, 10) },
      "25": { bid: near(bidLv, 25), ask: near(askLv, 25) },
      "50": { bid: near(bidLv, 50), ask: near(askLv, 50) },
    },
  };
}

/** Decimal places in a venue step such as 0.001 or 0.5. */
export function stepDecimals(step: number): number {
  if (!(step > 0)) return 0;
  const s = step.toString();
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  return s.includes(".") ? s.split(".")[1]!.length : 0;
}

/** Snap to a venue step. Small epsilon so 0.3 / 0.1 does not floor to 2. */
export function snapToStep(x: number, step: number, mode: "round" | "floor" | "ceil" = "round"): number {
  if (!(step > 0) || !Number.isFinite(x)) return x;
  const q = x / step;
  const n = mode === "floor" ? Math.floor(q + 1e-9) : mode === "ceil" ? Math.ceil(q - 1e-9) : Math.round(q);
  return Number((n * step).toFixed(stepDecimals(step)));
}

/**
 * Post-only price `inside` ticks inside the touch. Never crosses.
 * If the spread is too tight, join the touch.
 */
export function quotePrice(side: Side, book: Book, tick: number, inside = config.quoteInsideTicks): number {
  let raw = side === "buy" ? book.bid + inside * tick : book.ask - inside * tick;
  if (side === "buy" && raw >= book.ask) raw = book.bid;
  if (side === "sell" && raw <= book.bid) raw = book.ask;
  return snapToStep(raw, tick, side === "buy" ? "floor" : "ceil");
}

/**
 * Crossing limit for an IOC exit. Walks `slippageBps` past the far touch so the
 * order clears the visible book. Rounds away from the touch so tick alignment can
 * never pull the price back inside the spread.
 */
export function takerPrice(side: Side, book: Book, tick: number, slippageBps = config.closeSlippageBps): number {
  const bps = Math.max(0, slippageBps) / 10_000;
  const raw = side === "buy" ? book.ask * (1 + bps) : book.bid * (1 - bps);
  return Math.max(tick, snapToStep(raw, tick, side === "buy" ? "ceil" : "floor"));
}
