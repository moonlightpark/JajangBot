import type { VenueAccount } from "./account";
import type { Ohlc } from "./chart";
import type { AssetCtx } from "./indicators";
import type { RiskRule } from "./risk";
import type { Book, Fill, PricePoint, Quote, Side } from "./types";

export type VenueFillPrint = { ts: number; side: Side; price: number; size: number; dir?: Fill["dir"]; hash?: string; slipBps?: number; risk?: RiskRule };

/** What the Trader needs from the exchange. BybitMarket implements it; tests use a fake. */
export interface VenueMarket {
  /** Non-null when this sleeve sends real orders. */
  readonly wallet: object | null;
  readonly coin: string;
  readonly pair: string;
  readonly label: string;
  readonly address: string | null;
  account: VenueAccount | null;
  szDecimals: number;
  maxLeverage: number;
  readonly fillPrints: VenueFillPrint[];
  onVenueFill: ((fill: VenueFillPrint) => void) | null;
  readonly chartPoints: PricePoint[];
  readonly assetCtx: AssetCtx | null;
  candleCloses(limit?: number): number[];
  /** Venue candles oldest first, for rule-based strategies. */
  bars(bar: "1m" | "15m"): Ohlc[];
  /** One order's size at `mid`: `baseUsd` (QUOTE_USD by default), shrunk to `roomUsd` left under MAX_ACCOUNT_LEVERAGE. */
  quoteSize(mid: number, roomUsd?: number, baseUsd?: number): number;
  init(): Promise<void>;
  refresh(): Promise<void>;
  readBook(): Book;
  setLeverage(raw: number): Promise<number>;
  /** `risk` tags the risk watchdog's close, so its fill says so. */
  send(side: Side, sizeSz: number, book: Book, cancel: number[], reduceOnly?: boolean, taker?: boolean, risk?: RiskRule): Promise<Quote>;
  /** When the book last changed. Left out by test fakes: never stale. */
  readonly bookAt?: number;
  /** A full-position stop on the venue (risk watchdog). null clears it. Left out: none. */
  setStopLoss?(px: number | null): Promise<void>;
  cancelResting(): Promise<number[]>;
}
