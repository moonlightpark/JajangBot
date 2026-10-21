import type { Action, Bias, Intent, Side } from "./types";

export type { Bias, Intent };

/** Integer leverage rungs up to the coin's max leverage. */
export function leverageRungs(max: number): number[] {
  const cap = Math.max(1, Math.floor(Number(max) || 1));
  const out = [1, 2, 3, 5, 10, 20, 40, 50].filter((n) => n <= cap);
  if (!out.includes(cap)) out.push(cap);
  return out;
}

export function parseLeverage(raw: unknown, max: number, fallback: number): number {
  const n = typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
  const rungs = leverageRungs(max);
  const seed = Number.isFinite(n) && n >= 1 ? Math.round(n) : fallback;
  return rungs.reduce((best, x) => (Math.abs(x - seed) < Math.abs(best - seed) ? x : best), rungs[0]!);
}

/** A set leverage as is, rounded and held to 1..max. No rungs: 15 stays 15. */
export function clampLeverage(raw: number, max: number): number {
  const cap = Math.max(1, Math.floor(Number(max) || 1));
  const n = Number.isFinite(raw) ? Math.round(raw) : 1;
  return Math.max(1, Math.min(cap, n));
}

/** Close is only a real choice when a position exists. Flat plus close means stand down. */
export function liveIntent(positionSide: "long" | "short" | "flat", picked: Intent): Intent {
  if (positionSide !== "flat") return picked;
  return picked === "open" ? "open" : "hold";
}

export function quoteAction(intent: Intent, bias: Bias): Action {
  if (intent === "hold") return "hold";
  if (intent === "open") return bias === "long" ? "buy" : "sell";
  return bias === "long" ? "sell" : "buy";
}

/**
 * One order per tick, or nothing. Entries rest post-only so they earn the spread.
 * Exits cross as Ioc takers: a resting exit only fills when the market moves your
 * way, which caps winners at the spread and lets losers run.
 */
export interface QuotePlan {
  side: Side;
  size: number;
  reduceOnly: boolean;
  taker: boolean;
}

/**
 * True when an open on `side` would push the position past `maxPositionUsd`.
 * An open against the position shrinks it, so it never trips the cap.
 */
export function overPositionCap(opts: {
  side: Side;
  positionSz: number;
  quoteSz: number;
  mid: number;
  maxPositionUsd: number | null;
}): boolean {
  if (opts.maxPositionUsd == null) return false;
  const grows = opts.side === "buy" ? opts.positionSz >= 0 : opts.positionSz <= 0;
  if (!grows) return false;
  return (Math.abs(opts.positionSz) + opts.quoteSz) * opts.mid > opts.maxPositionUsd;
}

/** Map Jev's open/close/hold + long/short onto one order. `null` means pull the book. */
export function planQuote(opts: {
  intent: Intent;
  bias: Bias;
  positionSz: number;
  quoteSz: number;
  mid?: number;
  maxPositionUsd?: number | null;
  /** Close only this share of the position, floored to `qtyStep`. A part that would leave less than one step closes it all. */
  closeFraction?: number;
  qtyStep?: number;
}): QuotePlan | null {
  if (opts.intent === "hold") return null;
  if (opts.intent === "open") {
    if (opts.quoteSz <= 0) return null;
    const side = quoteAction(opts.intent, opts.bias) as Side;
    if (overPositionCap({
      side,
      positionSz: opts.positionSz,
      quoteSz: opts.quoteSz,
      mid: opts.mid ?? 0,
      maxPositionUsd: opts.maxPositionUsd ?? null,
    })) return null;
    return { side, size: opts.quoteSz, reduceOnly: false, taker: false };
  }
  // Close flattens the live book, or with closeFraction trims it. Long/short is the stance, not which side to reduce.
  const held = Math.abs(opts.positionSz);
  if (held === 0) return null;
  const size = closeSize(held, opts.closeFraction, opts.qtyStep);
  return { side: opts.positionSz > 0 ? "sell" : "buy", size, reduceOnly: true, taker: true };
}

/**
 * How much a close takes: all of `held`, or `fraction` of it floored to `step`. A part under
 * one step, or one that would leave less than a step, takes it all.
 */
export function closeSize(held: number, fraction?: number, step = 0): number {
  if (!fraction || !(fraction > 0) || fraction >= 1) return held;
  const raw = held * fraction;
  const part = step > 0 ? Math.floor(raw / step + 1e-9) * step : raw;
  const floor = step > 0 ? step : 0;
  if (part < floor || part <= 0 || held - part < floor - 1e-12 || held - part <= 1e-12) return held;
  return +part.toFixed(12);
}
