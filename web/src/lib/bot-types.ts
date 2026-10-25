/** Wire types. Copied to web/src/lib/bot-types.ts. Keep both files identical. */
export type Action = "buy" | "sell" | "hold";
export type Side = "buy" | "sell";
export type Bias = "long" | "short";
/** `hold` posts nothing and pulls any resting quote. */
export type Intent = "open" | "close" | "hold";

export interface Book {
  block: number;
  bid: number;
  ask: number;
  mid: number;
  spreadBps: number;
  /** (bidDepth - askDepth) / (bidDepth + askDepth) within 1% of mid. -1..1 */
  imbalance: number;
  levels: { bids: [number, number][]; asks: [number, number][] };
  depthBps: { [band: string]: { bid: number; ask: number } };
}

/** This tick's order. Entries are post-only limits, exits are Ioc takers. */
export interface Quote {
  side: Side;
  price: number;
  size: number;
  txHash: string | null;
  cancel: number[];
  status: "placed" | "reverted" | "sim";
  orderId: number | null;
  capped: boolean;
  reduceOnly?: boolean;
  unchanged?: boolean;
  /** Ioc order that crossed the touch instead of resting on it. */
  taker?: boolean;
}

/** A taker hit one of our resting orders. */
export interface Fill {
  side: Side;
  size: number;
  price: number;
  txHash: string | null;
  orderId: number;
  simulated: boolean;
  feeUsd?: number;
  closedPnl?: number;
  dir?: "open" | "close" | "flip";
  /** Price the order was decided at (the tick's mid). */
  refPx?: number;
  /** Fill against `refPx` in bps, positive when it cost us (bought higher or sold lower). */
  slipBps?: number;
  /** Closed by the risk watchdog, not the model. */
  risk?: "stop" | "volume";
}

/** Compact tape print. Candles carry o/h/l/c. Fills sit on this series. */
export interface PricePoint {
  ts: number;
  mid: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  bar?: "1s" | "1m" | "15m";
  block?: number;
  fill?: {
    side: Side;
    price: number;
    size: number;
    dir?: "open" | "close" | "flip";
    hash?: string;
    closedPnl?: number;
    feeUsd?: number;
    slipBps?: number;
    risk?: "stop" | "volume";
  };
}

export interface Decision {
  action: Action;
  intent?: Intent;
  bias?: Bias;
  leverage?: number;
  probabilities: {
    buy: number;
    sell: number;
    hold: number;
    long?: number;
    short?: number;
    open?: number;
    close?: number;
  };
  upIn10: number;
  latencyMs: number;
  late: boolean;
  /** A close of only this share of the position (partial take profit). Left out: all of it. */
  closeFraction?: number;
  /**
   * The risk watchdog's close, made by code on its own timer, not by the model. The
   * dashboard must say so, so the page never implies the model (or Jev) made this call.
   */
  risk?: { rule: "stop" | "volume"; reason: string };
}

export interface Position {
  side: "long" | "short" | "flat";
  size: number;
  entryPrice: number | null;
  leverage: number | null;
  unrealizedUsd: number;
  unrealizedSz: number;
}

export interface Totals {
  blocks: number;
  decisions: number;
  quotes: number;
  fills: number;
  reverted: number;
  lateBlocks: number;
  jevUsd: number;
  gasSz: number;
  gasUsd: number;
  realizedUsd: number;
  pnlUsd: number;
  pnlSz: number;
  pnlPct: number;
}

/** MODEL=strategy channel lines on this tick: enter long below `long`, short above `short`. */
export interface StrategyLevels {
  long: number;
  short: number;
  timeframe: string;
}

/** GET /levels: the strategy channel at the close of one 15m bar (`ts` is the bar start). */
export interface ChannelPoint {
  ts: number;
  long: number;
  short: number;
}

export interface BlockEvent {
  coin: string;
  block: number;
  ts: number;
  mid: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  decision: Decision | null;
  quote: Quote | null;
  fill: Fill | null;
  resting: { bidSz: number; askSz: number };
  position: Position;
  totals: Totals;
  /** Strategy lines when MODEL=strategy has enough bars. Absent for mock and jev. */
  levels?: StrategyLevels | null;
  /** Bybit sub-account equity for this sleeve. */
  accountValue?: number | null;
  withdrawable?: number | null;
}

export interface SleeveMeta {
  coin: string;
  pair: string;
  label: string;
  wallet: string | null;
  /**
   * Dry run only: net PnL of closed `bun run backtest` trades added to this sleeve's
   * starting balance, so the balance runs on from the backtest. 0 with a wallet.
   */
  backtestUsd?: number;
  /** Dry run only: this sleeve's share of BANKROLL_USD, before the backtest. Left out with a wallet. */
  startUsd?: number;
  /**
   * Dry run only: the backtest's open position the bot started out holding. Its PnL is the
   * bot's from then on, so it is not counted again as backtest open PnL.
   */
  carried?: BacktestOpen;
}

export interface Meta {
  model: string;
  wallet: string | null;
  dryRun: boolean;
  /**
   * The 가상매매 switch: on means no real orders, the backtest then a live dry run.
   * `toggle` is false when the bot has no ADMIN_TOKEN, so the switch only shows the state.
   * `keys` is false when no coin has a Bybit key, so turning it off cannot trade for real.
   */
  virtual?: { on: boolean; toggle: boolean; keys: boolean };
  /**
   * The risk watchdog and the size cap, from .env. Null means off. When either rule is on,
   * code can close a position apart from the decider, and the header says so.
   */
  risk?: {
    stopPct: number | null;
    volumePct: number | null;
    maxAccountLeverage: number | null;
    /** Entries one position may take (1 + adds). MAX_ACCOUNT_LEVERAGE splits over them. */
    entries: number;
    dailyHourKst: number | null;
  };
  market: string;
  startedAt: number;
  venue: string;
  /** mainnet trades real funds. testnet and demo are venue sandboxes. */
  network: "mainnet" | "testnet" | "demo";
  coin: string;
  pair: string;
  explorerTx: string;
  tickMs: number;
  sleeves: SleeveMeta[];
}

export interface Timing {
  readMs: number;
  loopMs: number;
}

/** One simulated trade from `bun run backtest`. Not a fill, and the strategy made the call, not Jev. */
export interface BacktestTrade {
  side: "long" | "short";
  /** First entry. */
  entryTs: number;
  /** Average entry over all entries. */
  entryPx: number;
  /**
   * Every entry, oldest first, when there was more than one (adds, 물타기). `round` is the
   * entry number when it differs from the position in the list (re-entries after the
   * take profit at the first entry price count from entry 2 again).
   */
  entries?: { ts: number; px: number; size: number; round?: number }[];
  /** null while still open at the end of the data. */
  exitTs: number | null;
  exitPx: number;
  size: number;
  /** Net of both fees. An open trade is marked at the last close and pays no exit fee. */
  pnlUsd: number;
  feesUsd: number;
  /** Worst move against the average entry while held, in percent. */
  maxAdversePct: number;
  /** A partial take profit: `size` of the position closed, the rest stayed open as a later trade. */
  partial?: boolean;
  /** Closed by the risk watchdog, not the strategy: the hard stop or the volume rule. */
  risk?: "stop" | "volume";
}

/** GET /backtest: the last `bun run backtest` run (MODEL=strategy rules on past 1m candles). */
export interface BacktestReport {
  from: number;
  to: number;
  ranAt: number;
  quoteUsd: number;
  leverageByCoin: Record<string, number>;
  tradesByCoin: Record<string, BacktestTrade[]>;
  /** The position each coin still held when the run ended, with the strategy's entry state. */
  openByCoin?: Record<string, BacktestOpen>;
}

/**
 * A backtest position still open at the end of the run. A dry run bot starts out holding it,
 * so its next entry, take profit, or stop follows on from the backtest.
 */
export interface BacktestOpen {
  side: "long" | "short";
  size: number;
  /** Average entry. */
  entryPx: number;
  /** Entry fees still carried by the open size. */
  feesUsd: number;
  /** First entry. */
  entryTs: number;
  /** Entry number the strategy counts (restarts at 1 after the first-price take profit). */
  count: number;
  /** Last entry, and the one before it. */
  lastTs: number;
  prevTs?: number;
  /** Partly closed since the last restart of the count. */
  trimmed?: boolean;
  /** Swing stop level, once the last entry is in. */
  level?: number;
  /** First entry's price. */
  firstPx: number;
  /** Price of the last first-price take profit. */
  tpPx?: number;
  /**
   * Every entry still in the position, oldest first. `round` is the entry number when it
   * differs from the position in the list. The dashboard lists them under 체결.
   */
  entries?: { ts: number; px: number; size: number; round?: number }[];
}

/** The bot's day, closed at DAILY_REPORT_HOUR_KST. GET /reports. */
export interface DailyReport {
  coin: string;
  /** KST date the day closed on. */
  date: string;
  from: number;
  to: number;
  /** The bot started inside this day, so the report covers only from then. */
  sinceStart?: boolean;
  startBalance: number;
  endBalance: number;
  pnlUsd: number;
  pnlPct: number;
  realizedUsd: number;
  feesUsd: number;
  entries: number;
  closes: number;
  /** Closes the risk watchdog made. */
  riskCloses: number;
  avgSlipBps: number | null;
  maxSlipBps: number | null;
  open: { side: "long" | "short"; size: number; entryPx: number } | null;
}
