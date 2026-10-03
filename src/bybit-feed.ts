import { bookFromLevels } from "./book";
import { bybitHosts, bybitSymbol, publicGet } from "./bybit-api";
import { VenueChart } from "./chart";
import { config } from "./config";
import { parseAssetCtx, type AssetCtx } from "./indicators";
import { TradeFeed } from "./trades";
import type { Book } from "./types";

const BOOK_DEPTH = 50;

/** Local L2 book kept from Bybit `orderbook.50` snapshot + delta messages. */
export class BybitBook {
  readonly bids = new Map<string, number>();
  readonly asks = new Map<string, number>();

  /** `type` is snapshot or delta. Size 0 deletes a level. */
  apply(type: string, data: { b?: [string, string][]; a?: [string, string][] }) {
    if (type === "snapshot") {
      this.bids.clear();
      this.asks.clear();
    }
    for (const [px, sz] of data.b ?? []) set(this.bids, px, sz);
    for (const [px, sz] of data.a ?? []) set(this.asks, px, sz);
  }

  toBook(tick: number): Book | null {
    const lv = (m: Map<string, number>) => [...m].map(([px, sz]) => ({ px, sz: String(sz) }));
    return bookFromLevels(tick, lv(this.bids), lv(this.asks));
  }
}

function set(side: Map<string, number>, px: string, sz: string) {
  const n = Number(sz);
  if (n > 0) side.set(px, n);
  else side.delete(px);
}

/** Map a Bybit linear ticker onto the asset context Jev reads (mark, index, funding, OI). */
export function bybitTickerCtx(t: Record<string, unknown>): AssetCtx {
  const mark = Number(t.markPrice), index = Number(t.indexPrice);
  const premium = mark > 0 && index > 0 ? (mark - index) / index : undefined;
  return parseAssetCtx({
    markPx: t.markPrice,
    oraclePx: t.indexPrice,
    funding: t.fundingRate,
    premium,
    openInterest: t.openInterest,
    prevDayPx: t.prevPrice24h,
    dayNtlVlm: t.turnover24h,
  });
}

/** Bybit kline row [start, open, high, low, close, ...] as the chart's candle shape. */
export function bybitCandle(row: unknown[], bar: "1m" | "15m") {
  return { t: Number(row[0]), o: row[1], h: row[2], l: row[3], c: row[4], i: bar };
}

/**
 * Bybit linear perp book + tape over the public WS, with REST snapshots so startup
 * does not wait on the socket. Ticks fire at `tickMs` once a book exists.
 */
export class BybitFeed {
  readonly trades = new TradeFeed();
  readonly chart = new VenueChart();
  readonly symbol: string;
  assetCtx: AssetCtx | null = null;
  book: Book | null = null;
  tick = 0;
  onPrice: ((book: Book) => void) | null = null;
  private hosts = bybitHosts(config.bybitEnv);
  private local = new BybitBook();
  private ticker: Record<string, unknown> = {};
  private lastTickAt = 0;
  private lastPriceAt = 0;
  private lastPriceMid = Number.NaN;
  private onTick: ((tick: number) => void) | null = null;
  private ws: WebSocket | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private seenTids = new Set<string>();

  constructor(readonly coin: string) {
    this.symbol = bybitSymbol(coin);
  }

  async connect(): Promise<void> {
    await this.snapshot();
    await this.loadCandles().catch((e) => {
      console.warn(`${this.coin} candles: ${(e as Error).message.slice(0, 160)}`);
    });
    this.pollTicker().catch(() => {});
    this.openSocket();
    setInterval(() => this.maybeTick(), config.tickMs);
    setInterval(() => { if (!this.ws || this.ws.readyState !== WebSocket.OPEN) this.snapshot().catch(() => {}); }, 2_000);
    setInterval(() => this.pollTicker().catch(() => {}), 15_000);
  }

  start(onTick: (tick: number) => void) {
    this.onTick = onTick;
    this.maybePrice();
    this.maybeTick();
  }

  private async snapshot() {
    const r = await publicGet<{ b?: [string, string][]; a?: [string, string][] }>(
      this.hosts.publicRest, "/v5/market/orderbook", { category: "linear", symbol: this.symbol, limit: BOOK_DEPTH },
    );
    this.local.apply("snapshot", r);
    const next = this.local.toBook(this.tick);
    if (next) this.book = next;
  }

  private async loadCandles() {
    const now = Date.now();
    const pull = async (interval: "1" | "15", bar: "1m" | "15m") => {
      const r = await publicGet<{ list?: unknown[][] }>(this.hosts.publicRest, "/v5/market/kline", {
        category: "linear", symbol: this.symbol, interval, end: now, limit: 1000,
      });
      for (const row of r.list ?? []) if (Array.isArray(row)) this.chart.upsertCandle(bybitCandle(row, bar));
    };
    await Promise.all([pull("15", "15m"), pull("1", "1m")]);
  }

  private async pollTicker() {
    const r = await publicGet<{ list?: Record<string, unknown>[] }>(this.hosts.publicRest, "/v5/market/tickers", {
      category: "linear", symbol: this.symbol,
    });
    const t = r.list?.[0];
    if (!t) return;
    this.ticker = { ...this.ticker, ...t };
    this.assetCtx = bybitTickerCtx(this.ticker);
  }

  private openSocket(delay = 0) {
    setTimeout(() => {
      const ws = new WebSocket(this.hosts.publicWs);
      this.ws = ws;
      ws.onopen = () => {
        this.send({
          op: "subscribe",
          args: [`orderbook.${BOOK_DEPTH}.${this.symbol}`, `publicTrade.${this.symbol}`, `kline.1.${this.symbol}`, `kline.15.${this.symbol}`, `tickers.${this.symbol}`],
        });
        if (this.ping) clearInterval(this.ping);
        this.ping = setInterval(() => this.send({ op: "ping" }), 20_000);
      };
      ws.onmessage = (e) => this.onMessage(String(e.data));
      ws.onclose = () => {
        if (this.ping) clearInterval(this.ping);
        this.ping = null;
        this.openSocket(Math.min(delay + 500, 8_000));
      };
      ws.onerror = () => ws.close();
    }, delay);
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(raw: string) {
    let m: { topic?: string; type?: string; data?: any };
    try { m = JSON.parse(raw); } catch { return; }
    const topic = m.topic ?? "";
    if (topic.startsWith("orderbook.") && m.data) {
      this.local.apply(m.type ?? "delta", m.data);
      const next = this.local.toBook(this.tick);
      if (next) {
        this.book = next;
        this.maybePrice();
        this.maybeTick();
      }
      return;
    }
    if (topic.startsWith("publicTrade.") && Array.isArray(m.data)) {
      for (const t of m.data) this.ingestPrint(t);
      return;
    }
    if (topic.startsWith("kline.") && Array.isArray(m.data)) {
      const i = topic.startsWith("kline.15.") ? "15m" : "1m";
      for (const k of m.data) this.chart.upsertCandle({ t: Number(k.start), o: k.open, h: k.high, l: k.low, c: k.close, i });
      return;
    }
    if (topic.startsWith("tickers.") && m.data) {
      this.ticker = { ...this.ticker, ...m.data };
      this.assetCtx = bybitTickerCtx(this.ticker);
    }
  }

  private ingestPrint(t: { i?: string; S?: string; v?: string; p?: string }) {
    if (t.i) {
      if (this.seenTids.has(t.i)) return;
      this.seenTids.add(t.i);
      if (this.seenTids.size > 4000) {
        const first = this.seenTids.values().next().value;
        if (first != null) this.seenTids.delete(first);
      }
    }
    this.trades.pushPrint({ price: Number(t.p), size: Number(t.v), side: t.S === "Buy" ? "buy" : "sell" });
  }

  private maybePrice() {
    if (!this.book) return;
    const now = Date.now();
    this.chart.addMid(this.book.mid, now);
    if (!this.onPrice) return;
    if (now - this.lastPriceAt < config.priceMs) return;
    if (this.book.mid === this.lastPriceMid) return;
    this.lastPriceAt = now;
    this.lastPriceMid = this.book.mid;
    this.onPrice(this.book);
  }

  private maybeTick() {
    if (!this.book || !this.onTick) return;
    const now = Date.now();
    if (now - this.lastTickAt < config.tickMs) return;
    this.lastTickAt = now;
    this.tick++;
    this.trades.setTick(this.tick);
    this.book = { ...this.book, block: this.tick };
    this.onTick(this.tick);
  }
}
