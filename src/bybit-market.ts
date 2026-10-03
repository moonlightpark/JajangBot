import { FillPnlBook, type VenueAccount } from "./account";
import { quotePrice, snapToStep, stepDecimals, takerPrice } from "./book";
import { BybitClient, BybitError, bybitHosts, bybitSymbol, publicGet } from "./bybit-api";
import type { BybitFeed } from "./bybit-feed";
import { config } from "./config";
import type { SleeveConfig } from "./sleeves";
import type { Book, Fill, Quote, Side } from "./types";
import type { VenueFillPrint, VenueMarket } from "./venue";

type QuoteBase = Required<Pick<Quote, "side" | "reduceOnly" | "capped" | "taker">>;

export type BybitPosition = {
  symbol?: string;
  side?: string;
  size?: string;
  avgPrice?: string;
  entryPrice?: string;
  unrealisedPnl?: string;
  leverage?: string;
  liqPrice?: string;
};

export type BybitWallet = { totalEquity?: string; totalAvailableBalance?: string };

export type BybitExecution = {
  symbol?: string;
  execType?: string;
  execId?: string;
  orderId?: string;
  side?: string;
  execPrice?: string;
  execQty?: string;
  leavesQty?: string;
  execFee?: string;
  execPnl?: string;
  closedSize?: string;
  execTime?: string;
};

const num = (x: unknown) => {
  const n = Number(x);
  return x !== "" && x != null && Number.isFinite(n) ? n : NaN;
};

/** Position and equity from Bybit position + wallet. Realized/fees come from executions. */
export function accountFromBybit(pos: BybitPosition | null, wallet: BybitWallet | null, prev?: VenueAccount | null): VenueAccount {
  const abs = num(pos?.size);
  const size = Number.isFinite(abs) ? (pos?.side === "Sell" ? -abs : pos?.side === "Buy" ? abs : 0) : 0;
  const entry = num(pos?.avgPrice ?? pos?.entryPrice);
  const unreal = num(pos?.unrealisedPnl);
  const equity = num(wallet?.totalEquity);
  const free = num(wallet?.totalAvailableBalance);
  const lev = num(pos?.leverage);
  const liq = num(pos?.liqPrice);
  return {
    positionSz: size,
    entryPrice: size && entry > 0 ? entry : null,
    unrealizedUsd: Number.isFinite(unreal) ? unreal : 0,
    realizedUsd: prev?.realizedUsd ?? 0,
    feesUsd: prev?.feesUsd ?? 0,
    accountValue: Number.isFinite(equity) ? equity : prev?.accountValue ?? 0,
    withdrawable: Number.isFinite(free) ? free : prev?.withdrawable ?? 0,
    leverage: lev > 0 ? lev : prev?.leverage ?? null,
    liquidationPx: size && liq > 0 ? liq : null,
  };
}

/** open, close, or flip from how much of the execution closed the prior position. */
export function bybitFillDir(e: BybitExecution): Fill["dir"] {
  const closed = num(e.closedSize), qty = num(e.execQty);
  if (!(closed > 0)) return "open";
  return qty > closed + 1e-12 ? "flip" : "close";
}

const GONE = new Set(["Filled", "Cancelled", "Rejected", "Deactivated", "PartiallyFilledCanceled"]);

/**
 * Bybit linear USDT perp for one coin on its own sub-account key.
 * PostOnly entries, amended when the side stays put. IOC exits.
 */
export class BybitMarket implements VenueMarket {
  readonly wallet: { address: string } | null;
  readonly coin: string;
  readonly pair: string;
  readonly label: string;
  readonly symbol: string;
  account: VenueAccount | null = null;
  szDecimals = 3;
  maxLeverage = 50;
  readonly fillPrints: VenueFillPrint[] = [];
  onVenueFill: ((fill: VenueFillPrint) => void) | null = null;
  private hosts = bybitHosts(config.bybitEnv);
  private client: BybitClient | null;
  private tickSize = 0.01;
  private qtyStep = 0.001;
  private minQty = 0.001;
  private minNotional = 5;
  private fills = new FillPnlBook();
  private pos: BybitPosition | null = null;
  private bal: BybitWallet | null = null;
  /** Bybit order ids are strings. The wire types carry numbers, so map both ways. */
  private nextId = 1;
  private toExchange = new Map<number, string>();
  private toLocal = new Map<string, number>();
  private lastOid: number | null = null;
  private lastSide: Side | null = null;
  private lastPrice = 0;
  private lastSize = 0;
  private lastReduce = false;
  private ws: WebSocket | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;

  constructor(private feed: BybitFeed, sleeve: SleeveConfig) {
    this.coin = sleeve.coin;
    this.pair = sleeve.pair;
    this.label = sleeve.label;
    this.symbol = bybitSymbol(sleeve.coin);
    const live = !config.dryRun && sleeve.bybit;
    this.client = live ? new BybitClient(sleeve.bybit!.apiKey, sleeve.bybit!.apiSecret, this.hosts.rest) : null;
    this.wallet = this.client ? { address: "bybit" } : null;
  }

  get address() {
    return this.wallet?.address ?? null;
  }

  get chartPoints() {
    return this.feed.chart.points;
  }

  get assetCtx() {
    return this.feed.assetCtx;
  }

  candleCloses(limit = 80) {
    return this.feed.chart.closes(limit);
  }

  bars(bar: "1m" | "15m") {
    return this.feed.chart.bars(bar);
  }

  /** QUOTE_USD in coin, raised to the venue minimum so the order is not rejected. */
  quoteSize(mid: number): number {
    if (!(mid > 0)) return 0;
    const want = snapToStep(config.quoteUsd / mid, this.qtyStep, "floor");
    const floor = Math.max(this.minQty, snapToStep(this.minNotional / mid, this.qtyStep, "ceil"));
    return Math.max(want, floor);
  }

  async init() {
    await this.loadInstrument();
    if (this.client) {
      await this.loadUid();
      await this.client.post("/v5/order/cancel-all", { category: "linear", symbol: this.symbol }).catch(() => {});
      this.openPrivate();
      await this.refresh();
      await this.seedFills();
    }
    const env = config.bybitEnv;
    const mid = this.feed.book?.mid ?? 0;
    const minUsd = mid ? ` · min order ${this.quoteSize(mid)} ${this.coin} ($${(this.quoteSize(mid) * mid).toFixed(2)})` : "";
    console.log(`bybit · ${this.symbol} ${env} · tick ${this.tickSize} · step ${this.qtyStep} · max ${this.maxLeverage}x${minUsd} · ${this.client ? `account ${this.address}` : "DRY RUN"}`);
    if (this.client) {
      const a = this.account;
      const side = !a || !a.positionSz ? "flat" : a.positionSz > 0 ? "long" : "short";
      const entry = a?.entryPrice != null ? ` @ ${a.entryPrice}` : "";
      console.log(`${this.label} · available $${(a?.withdrawable ?? 0).toFixed(2)} · equity $${(a?.accountValue ?? 0).toFixed(2)} · ${side} ${Math.abs(a?.positionSz ?? 0)} ${this.coin}${entry}`);
    }
  }

  private async loadInstrument() {
    const r = await publicGet<{ list?: any[] }>(this.hosts.publicRest, "/v5/market/instruments-info", {
      category: "linear", symbol: this.symbol,
    });
    const i = r.list?.[0];
    if (!i) throw new Error(`unknown Bybit symbol ${this.symbol}`);
    const tick = num(i.priceFilter?.tickSize), step = num(i.lotSizeFilter?.qtyStep);
    const minQty = num(i.lotSizeFilter?.minOrderQty), minNotional = num(i.lotSizeFilter?.minNotionalValue);
    const maxLev = num(i.leverageFilter?.maxLeverage);
    if (tick > 0) this.tickSize = tick;
    if (step > 0) this.qtyStep = step;
    if (minQty > 0) this.minQty = minQty;
    if (minNotional > 0) this.minNotional = minNotional;
    if (maxLev >= 1) this.maxLeverage = Math.floor(maxLev);
    if (config.maxLeverage != null) this.maxLeverage = Math.max(1, Math.min(this.maxLeverage, Math.floor(config.maxLeverage)));
    this.szDecimals = stepDecimals(this.qtyStep);
  }

  /** Show the sub-account UID, never the key. */
  private async loadUid() {
    try {
      const r = await this.client!.get<{ userID?: number | string }>("/v5/user/query-api", {});
      if (r.userID != null) (this.wallet as { address: string }).address = `bybit:${r.userID}`;
    } catch {
      // keep "bybit"
    }
  }

  async refresh() {
    if (!this.client) return;
    try {
      const [p, w] = await Promise.all([
        this.client.get<{ list?: BybitPosition[] }>("/v5/position/list", { category: "linear", symbol: this.symbol }),
        this.client.get<{ list?: BybitWallet[] }>("/v5/account/wallet-balance", { accountType: "UNIFIED" }),
      ]);
      this.pos = p.list?.find((x) => x.symbol === this.symbol) ?? null;
      this.bal = w.list?.[0] ?? this.bal;
      this.applyAccount();
    } catch {
      // keep last balances
    }
  }

  private applyAccount() {
    this.account = this.fills.apply(accountFromBybit(this.pos, this.bal, this.account));
  }

  private async seedFills() {
    try {
      const r = await this.client!.get<{ list?: BybitExecution[] }>("/v5/execution/list", {
        category: "linear", symbol: this.symbol, limit: 100,
      });
      for (const e of [...(r.list ?? [])].reverse()) this.noteExecution(e, false);
    } catch {
      // keep whatever WS has already delivered
    }
  }

  private localId(orderId: string): number {
    let id = this.toLocal.get(orderId);
    if (id == null) {
      id = this.nextId++;
      this.toLocal.set(orderId, id);
      this.toExchange.set(id, orderId);
    }
    return id;
  }

  /** Book a venue execution once. `live` also hands it to the Trader as a maker fill. */
  noteExecution(e: BybitExecution, live: boolean) {
    if (e.symbol && e.symbol !== this.symbol) return;
    if (e.execType && e.execType !== "Trade") return;
    const ts = num(e.execTime), price = num(e.execPrice), size = num(e.execQty);
    const side: Side | null = e.side === "Buy" ? "buy" : e.side === "Sell" ? "sell" : null;
    if (!side || !(price > 0) || !(size > 0)) return;
    const closedPnl = num(e.execPnl), feeUsd = num(e.execFee);
    if (!this.fills.add({ coin: this.coin, closedPnl: e.execPnl ?? 0, fee: e.execFee ?? 0, hash: e.execId, tid: e.execId }, this.coin)) return;
    if (this.account) this.account = this.fills.apply(this.account);
    const dir = bybitFillDir(e);
    const orderId = e.orderId ? this.localId(e.orderId) : 0;
    if (live) {
      const left = num(e.leavesQty);
      this.feed.trades.pushFill({
        block: this.feed.tick,
        txHash: "",
        orderId,
        price,
        size,
        updatedSize: Number.isFinite(left) ? left : -1,
        side,
        feeUsd: Number.isFinite(feeUsd) ? feeUsd : 0,
        closedPnl: Number.isFinite(closedPnl) ? closedPnl : undefined,
        dir,
      });
    }
    const print = {
      ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
      side,
      price,
      size,
      dir,
      ...(Number.isFinite(closedPnl) ? { closedPnl } : {}),
      ...(Number.isFinite(feeUsd) ? { feeUsd } : {}),
    };
    this.fillPrints.push(print);
    if (this.feed.chart.addFill(print)) this.onVenueFill?.(print);
  }

  private openPrivate(delay = 0) {
    setTimeout(() => {
      const ws = new WebSocket(this.hosts.privateWs);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ op: "auth", args: this.client!.wsAuth() }));
        if (this.ping) clearInterval(this.ping);
        this.ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: "ping" })); }, 20_000);
      };
      ws.onmessage = (e) => this.onPrivate(ws, String(e.data));
      ws.onclose = () => {
        if (this.ping) clearInterval(this.ping);
        this.ping = null;
        this.openPrivate(Math.min(delay + 500, 8_000));
      };
      ws.onerror = () => ws.close();
    }, delay);
  }

  private onPrivate(ws: WebSocket, raw: string) {
    let m: { op?: string; success?: boolean; ret_msg?: string; topic?: string; data?: any };
    try { m = JSON.parse(raw); } catch { return; }
    if (m.op === "auth") {
      if (m.success) ws.send(JSON.stringify({ op: "subscribe", args: ["execution.linear", "position.linear", "order.linear", "wallet"] }));
      else console.warn(`${this.label} bybit auth failed: ${m.ret_msg ?? ""}`);
      return;
    }
    const rows: any[] = Array.isArray(m.data) ? m.data : [];
    if (m.topic?.startsWith("execution")) {
      for (const e of rows) this.noteExecution(e, true);
      return;
    }
    if (m.topic?.startsWith("position")) {
      const p = rows.find((x) => x.symbol === this.symbol);
      if (p) {
        this.pos = p;
        this.applyAccount();
      }
      return;
    }
    if (m.topic?.startsWith("order")) {
      for (const o of rows) {
        if (o.symbol !== this.symbol || !GONE.has(o.orderStatus)) continue;
        const id = this.toLocal.get(o.orderId);
        if (id != null && id === this.lastOid) this.forgetResting();
      }
      return;
    }
    if (m.topic === "wallet" && rows[0]) {
      this.bal = rows[0];
      this.applyAccount();
    }
  }

  readBook(): Book {
    if (!this.feed.book) throw new Error(`no Bybit book yet for ${this.coin}`);
    return this.feed.book;
  }

  async setLeverage(raw: number): Promise<number> {
    const leverage = Math.max(1, Math.min(this.maxLeverage, Math.round(raw)));
    if (!this.client) return leverage;
    if (this.account?.leverage === leverage) return leverage;
    try {
      await this.client.post("/v5/position/set-leverage", {
        category: "linear", symbol: this.symbol, buyLeverage: String(leverage), sellLeverage: String(leverage),
      });
    } catch (e) {
      // 110043: leverage not modified. Already where Jev wants it.
      if (!(e instanceof BybitError && e.retCode === 110043)) {
        console.warn(`${this.label} leverage: ${(e as Error).message.slice(0, 160)}`);
        return this.account?.leverage ?? leverage;
      }
    }
    if (this.account) this.account.leverage = leverage;
    return leverage;
  }

  /** Entries rest PostOnly. Exits cross as IOC so they do not wait on a taker. */
  async send(side: Side, sizeSz: number, book: Book, cancel: number[], reduceOnly = false, taker = false): Promise<Quote> {
    const size = snapToStep(sizeSz, this.qtyStep, "floor");
    const base: QuoteBase = { side, reduceOnly, capped: false, taker };
    if (!(size > 0)) {
      return { ...base, price: 0, size: 0, txHash: null, cancel, status: "reverted", orderId: null };
    }
    const px = taker ? takerPrice(side, book, this.tickSize) : quotePrice(side, book, this.tickSize);
    if (!this.client) {
      return { ...base, price: px, size, txHash: null, cancel, status: "sim", orderId: null };
    }
    return taker ? this.sendTaker(size, px, base) : this.sendMaker(size, px, cancel, base);
  }

  private order(side: Side, size: number, px: number, reduceOnly: boolean, timeInForce: "PostOnly" | "IOC") {
    return {
      category: "linear",
      symbol: this.symbol,
      side: side === "buy" ? "Buy" : "Sell",
      orderType: "Limit",
      qty: size.toFixed(stepDecimals(this.qtyStep)),
      price: px.toFixed(stepDecimals(this.tickSize)),
      timeInForce,
      reduceOnly,
      positionIdx: 0,
    };
  }

  private async cancelLocal(id: number) {
    const orderId = this.toExchange.get(id);
    if (!orderId || !this.client) return;
    await this.client.post("/v5/order/cancel", { category: "linear", symbol: this.symbol, orderId }).catch(() => {});
  }

  private async sendTaker(size: number, px: number, base: QuoteBase): Promise<Quote> {
    // The standing entry sits on the far side of an exit. Pull it before crossing.
    const open = this.lastOid;
    const cancel = open != null ? [open] : [];
    if (open != null) {
      await this.cancelLocal(open);
      this.forgetResting();
    }
    try {
      const r = await this.client!.post<{ orderId?: string }>("/v5/order/create", this.order(base.side, size, px, base.reduceOnly, "IOC"));
      // IOC fills arrive on the execution stream. An unfilled IOC leaves nothing behind.
      return { ...base, price: px, size, txHash: null, cancel, status: "placed", orderId: r.orderId ? this.localId(r.orderId) : null };
    } catch (e) {
      this.warn("exit", e);
      return { ...base, price: px, size, txHash: null, cancel, status: "reverted", orderId: null };
    }
  }

  private async sendMaker(size: number, px: number, cancel: number[], base: QuoteBase): Promise<Quote> {
    const { side, reduceOnly } = base;
    if (
      this.lastOid != null &&
      this.lastSide === side &&
      this.lastPrice === px &&
      this.lastSize === size &&
      this.lastReduce === reduceOnly
    ) {
      return { ...base, price: px, size, txHash: null, cancel: [], status: "placed", orderId: this.lastOid, unchanged: true };
    }

    try {
      if (this.lastOid != null && this.lastSide === side && this.lastReduce === reduceOnly) {
        const id = this.lastOid;
        try {
          await this.client!.post("/v5/order/amend", {
            category: "linear",
            symbol: this.symbol,
            orderId: this.toExchange.get(id),
            qty: size.toFixed(stepDecimals(this.qtyStep)),
            price: px.toFixed(stepDecimals(this.tickSize)),
          });
          this.lastPrice = px;
          this.lastSize = size;
          return { ...base, price: px, size, txHash: null, cancel: [], status: "placed", orderId: id };
        } catch {
          // Filled or gone between ticks. Place a fresh quote below.
          this.forgetResting();
        }
      }

      const ids = this.lastOid != null ? [this.lastOid] : cancel.filter((id) => id > 0);
      for (const id of ids) await this.cancelLocal(id);
      this.lastOid = null;

      const r = await this.client!.post<{ orderId?: string }>("/v5/order/create", this.order(side, size, px, reduceOnly, "PostOnly"));
      if (!r.orderId) {
        this.forgetResting();
        return { ...base, price: px, size, txHash: null, cancel: ids, status: "reverted", orderId: null };
      }
      // A PostOnly that would cross is cancelled by the venue; the order stream clears it.
      this.lastOid = this.localId(r.orderId);
      this.lastSide = side;
      this.lastPrice = px;
      this.lastSize = size;
      this.lastReduce = reduceOnly;
      return { ...base, price: px, size, txHash: null, cancel: ids, status: "placed", orderId: this.lastOid };
    } catch (e) {
      this.warn("quote", e);
      return { ...base, price: px, size, txHash: null, cancel, status: "reverted", orderId: this.lastOid };
    }
  }

  /** Pull the standing quote. A resting order Jev no longer wants still gets hit. */
  async cancelResting(): Promise<number[]> {
    const id = this.lastOid;
    if (!this.client || id == null) return [];
    await this.cancelLocal(id);
    this.forgetResting();
    return [id];
  }

  private forgetResting() {
    this.lastOid = null;
    this.lastSide = null;
    this.lastPrice = 0;
    this.lastSize = 0;
    this.lastReduce = false;
  }

  private warn(what: string, e: unknown) {
    const msg = (e as Error).message ?? String(e);
    if (e instanceof BybitError && e.retCode === 10006) console.warn(`${this.label}: bybit rate limited; ${what} skipped`);
    else console.warn(`${this.label} ${what}: ${msg.slice(0, 180)}`);
  }
}
