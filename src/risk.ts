/**
 * The risk watchdog's rules. They run on their own timer, apart from the model's call, and
 * the model never overrides them. Shared by the live Trader and the backtest so both close
 * at the same place. Every rule is off until its .env value is set.
 */

export type RiskRule = "stop" | "volume";

export interface RiskRules {
  /** Close all when price moves this many percent against the average entry. null: off. */
  stopPct: number | null;
  /** Close all when 6h turnover falls below this share of the 24h average per 6h. null: off. */
  volumeRatio: number | null;
}

export interface RiskHit {
  rule: RiskRule;
  /** Short Korean line for the log and the dashboard. */
  reason: string;
  /** Stop: the stop price. Volume: the ratio that tripped. */
  value: number;
}

/** The price the hard stop sits at, or null when it is off. */
export function riskStopPrice(side: "long" | "short", entryPx: number, stopPct: number | null): number | null {
  if (stopPct == null || !(stopPct > 0) || !(entryPx > 0)) return null;
  return side === "long" ? entryPx * (1 - stopPct / 100) : entryPx * (1 + stopPct / 100);
}

/** True when `px` (a low for a long, a high for a short) has reached the stop. */
export function stopHit(side: "long" | "short", stopPx: number, px: number): boolean {
  return side === "long" ? px <= stopPx : px >= stopPx;
}

/** 15m bars per window. */
const BARS_6H = 24;
const BARS_24H = 96;

/**
 * 6h turnover over the 24h average per 6h, from 15m turnover, newest last (the forming
 * bar included). Null until 24h of bars with turnover are there.
 */
export function volumeRatio(turnover15m: number[]): number | null {
  if (turnover15m.length < BARS_24H) return null;
  const day = turnover15m.slice(-BARS_24H);
  if (day.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const sum24 = day.reduce((s, v) => s + v, 0);
  if (!(sum24 > 0)) return null;
  const sum6 = day.slice(-BARS_6H).reduce((s, v) => s + v, 0);
  return sum6 / (sum24 / 4);
}

/**
 * The first rule that says close, or null. `extreme` is the worst price since the last
 * check (the low for a long, the high for a short); live passes the mid.
 */
export function riskCheck(
  rules: RiskRules,
  pos: { side: "long" | "short"; entryPx: number },
  extreme: number,
  turnover15m: number[] | null,
): RiskHit | null {
  const stopPx = riskStopPrice(pos.side, pos.entryPx, rules.stopPct);
  if (stopPx != null && stopHit(pos.side, stopPx, extreme)) {
    return { rule: "stop", value: stopPx, reason: `리스크 손절: 평균 진입가 대비 ${rules.stopPct}% (${round(stopPx)})` };
  }
  if (rules.volumeRatio != null && rules.volumeRatio > 0 && turnover15m) {
    const ratio = volumeRatio(turnover15m);
    if (ratio != null && ratio < rules.volumeRatio) {
      return { rule: "volume", value: ratio, reason: `거래량 급감: 6시간 거래대금이 24시간 평균의 ${Math.round(ratio * 100)}% (기준 ${Math.round(rules.volumeRatio * 100)}%)` };
    }
  }
  return null;
}

/**
 * Room left under MAX_ACCOUNT_LEVERAGE: the position may grow to `maxLeverage` times the
 * balance (1 = notional up to the balance). `exposureUsd` is what is already held on the side
 * the order adds to. Infinity when there is no cap.
 */
export function leverageRoomUsd(maxLeverage: number | null, equityUsd: number, exposureUsd: number): number {
  if (maxLeverage == null || !(maxLeverage > 0)) return Infinity;
  return Math.max(0, maxLeverage * Math.max(0, equityUsd) - Math.max(0, exposureUsd));
}

/**
 * One entry's notional under MAX_ACCOUNT_LEVERAGE: the cap split over every entry the strategy
 * may make (1 + adds), so the last entry still fits. null when there is no cap.
 */
export function entryBudgetUsd(maxLeverage: number | null, equityUsd: number, entries: number): number | null {
  if (maxLeverage == null || !(maxLeverage > 0)) return null;
  return (maxLeverage * Math.max(0, equityUsd)) / Math.max(1, entries);
}

const round = (x: number) => Math.round(x * 100) / 100;
