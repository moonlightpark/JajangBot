import type { BlockEvent, Meta } from "./bot-types";

export interface LeverageView {
  /** Balance the bot sizes from: Bybit equity, or the dry run's own. */
  equityUsd: number;
  /** Open position at the mark. */
  positionUsd: number;
  /** positionUsd / equityUsd: how many times the balance is held. */
  leverage: number;
  /** MAX_ACCOUNT_LEVERAGE, or null when there is no cap. */
  maxLeverage: number | null;
  /** maxLeverage x balance. */
  limitUsd: number | null;
  /** What the cap still lets in on the held side. */
  roomUsd: number | null;
  /** The next entry's size: the cap split over every entry, shrunk to the room. */
  nextOrderUsd: number | null;
}

/**
 * The account leverage and the order limit, the way the bot works them out at its next order
 * (src/risk.ts leverageRoomUsd, entryBudgetUsd). Null until the sleeve reports a balance.
 */
export function leverageView(latest: BlockEvent | null, risk: Meta["risk"] | undefined): LeverageView | null {
  const equity = latest?.accountValue;
  if (latest == null || equity == null || !Number.isFinite(equity) || !(equity > 0)) return null;
  const pos = latest.position;
  const positionUsd = pos && pos.side !== "flat" && pos.size > 0 ? pos.size * latest.mid : 0;
  const maxLeverage = risk?.maxAccountLeverage != null && risk.maxAccountLeverage > 0 ? risk.maxAccountLeverage : null;
  const limitUsd = maxLeverage != null ? maxLeverage * equity : null;
  const roomUsd = limitUsd != null ? Math.max(0, limitUsd - positionUsd) : null;
  const budget = limitUsd != null ? limitUsd / Math.max(1, risk?.entries ?? 1) : null;
  return {
    equityUsd: equity,
    positionUsd,
    leverage: positionUsd / equity,
    maxLeverage,
    limitUsd,
    roomUsd,
    nextOrderUsd: budget != null && roomUsd != null ? Math.min(budget, roomUsd) : null,
  };
}
