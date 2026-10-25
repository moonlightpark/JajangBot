import { config } from "./config";
import { bpsBetween, snapshotIndicators, venueFeatures } from "./indicators";
import { carriedSize, type Model, type ModelDecision, type TradeState } from "./model";
import { slipBps } from "./book";
import { planQuote, type QuotePlan } from "./plan";
import { entryBudgetUsd, leverageRoomUsd, riskCheck, riskStopPrice, type RiskRule } from "./risk";
import { aggregateFills, emptySummary, takeLiveFills, takeSimFills, type Resting, type TradeFeed } from "./trades";
import type { BacktestOpen, BlockEvent, Book, Fill, PricePoint, Quote, Side, Timing, Totals } from "./types";
import type { VenueMarket } from "./venue";

const emptyTotals = (): Totals => ({
  blocks: 0, decisions: 0, quotes: 0, fills: 0, reverted: 0, lateBlocks: 0,
  jevUsd: 0, gasSz: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlSz: 0, pnlPct: 0,
});

const JEV_PAUSE_MS = 30_000;

export function jevUnavailable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /402\b|no available TypeSafe API credits|insufficient credits/i.test(msg);
}

/**
 * Every tick: read the book and ask the model. A tick is late only when Jev
 * is still answering. Venue leverage/order I/O runs in the background
 * so a fill or quote does not stall the next decision.
 */
export class Trader {
  readonly history: BlockEvent[] = [];
  private mids: number[] = [];
  private busy = false;
  private lastBook: Book | null = null;
  private trades: TradeFeed | null = null;
  private orders = new Map<number, Resting>();
  private simId = 0;
  private sendSeq = 0;
  private exchangeTail: Promise<void> = Promise.resolve();
  private position = { sz: 0, costUsd: 0 };
  private totals: Totals = emptyTotals();
  private jevPauseUntil = 0;
  private lastBlock = 0;
  /** Book older than RISK_STALE_MS: new entries wait, the watchdog says so once. */
  private stale = false;
  /** The watchdog sent a close; it waits this long before trying again. */
  private riskBusyUntil = 0;
  /** Blocks whose order the risk watchdog sent, so their fills say so. */
  private riskBlocks = new Map<number, RiskRule>();
  /** Every fill since the bot started, for the daily report. */
  readonly ledger: { ts: number; fill: Fill }[] = [];
  /** Dry run starting balance for this sleeve. index.ts splits BANKROLL_USD across sleeves. */
  bankrollUsd = config.bankrollUsd;

  constructor(
    private market: VenueMarket,
    private model: Model,
    private onEvent: (e: BlockEvent, timing?: Timing) => void,
    private onFill: (block: number, fill: Fill) => void = () => {},
    private onQuote: (block: number, quote: Quote) => void = () => {},
  ) {}

  get tape(): PricePoint[] {
    return this.market.chartPoints;
  }

  /**
   * Dry run: start out holding the backtest's open position, so the strategy's next add,
   * take profit, or stop follows on from it. The model gets its entry state too.
   * The caller takes the entry fees off `bankrollUsd`. No-op with a wallet.
   */
  carry(open: BacktestOpen): boolean {
    if (this.market.wallet || !(open.size > 0)) return false;
    const sz = carriedSize(open.size) * (open.side === "long" ? 1 : -1);
    this.position = { sz, costUsd: sz * open.entryPx };
    this.model.carry?.(open);
    return true;
  }

  attachTradeFeed(feed: TradeFeed) {
    this.trades = feed;
  }

  async onBlock(block: number) {
    this.totals.blocks++;
    if (this.totals.blocks % 5 === 0) this.market.refresh().catch(() => {});
    if (this.busy) {
      this.markLate(block, this.lastBook);
      return;
    }
    this.busy = true;
    const t0 = performance.now();
    try {
      const book = this.market.readBook();
      const readMs = performance.now() - t0;
      this.lastBook = book;
      this.mids.push(book.mid);
      if (this.mids.length > 400) this.mids.shift();
      this.harvest();

      this.syncFromVenue();
      const timing = { readMs: Math.round(readMs), loopMs: 0 };
      if (Date.now() < this.jevPauseUntil) {
        this.markLate(block, book);
        return;
      }
      try {
        const decision = await this.model.decide(this.buildState(block, book));
        this.totals.decisions++;
        this.totals.jevUsd += (decision.inputTokens / 1e6) * config.jevUsdPerMTok;
        this.lastBlock = block;
        // MAX_ACCOUNT_LEVERAGE: only an open that adds to the held side (or opens from flat) counts.
        const posSide = this.position.sz > 0 ? "long" : this.position.sz < 0 ? "short" : "flat";
        const adds = decision.intent === "open" && (posSide === "flat" || posSide === decision.bias);
        const equity = this.equityUsd();
        const room = adds ? leverageRoomUsd(config.maxAccountLeverage, equity, Math.abs(this.position.sz) * book.mid) : Infinity;
        // With the cap, every entry is its share of it from the first one on, so the last still fits.
        const budget = entryBudgetUsd(config.maxAccountLeverage, equity, this.entrySlots());
        const quoteSz = this.market.quoteSize(book.mid, room, budget ?? undefined);
        const plan = planQuote({
          intent: decision.intent,
          bias: decision.bias,
          positionSz: this.position.sz,
          quoteSz,
          mid: book.mid,
          maxPositionUsd: config.maxPositionUsd,
          closeFraction: decision.closeFraction,
          qtyStep: 10 ** -this.market.szDecimals,
        });
        if (!plan && decision.intent === "open" && quoteSz > 0) {
          console.log(`${this.market.label} #${block} open held at MAX_POSITION_USD $${config.maxPositionUsd}`);
        }
        if (decision.intent === "open" && !(quoteSz > 0) && config.maxAccountLeverage != null) {
          console.log(`${this.market.label} #${block} open held at MAX_ACCOUNT_LEVERAGE ${config.maxAccountLeverage}x: the room left ($${Math.round(room)}) is under the venue's minimum order`);
        }
        // A stale book is no price to enter at. Exits still go: they cross as IOC.
        const held = plan && !plan.reduceOnly && this.isStale();
        if (held) console.log(`${this.market.label} #${block} open held: the book is stale`);
        timing.loopMs = Math.round(performance.now() - t0);
        this.emit(block, book, decision, null, false, timing);
        if (plan && !held) this.enqueueQuote(block, decision, plan, book);
        else this.enqueueStandDown();
      } catch (e) {
        const msg = (e as Error).message;
        if (jevUnavailable(e)) {
          this.jevPauseUntil = Date.now() + JEV_PAUSE_MS;
          console.error(`jev paused ${JEV_PAUSE_MS / 1000}s: ${msg}`);
        } else {
          console.error(`tick ${block}:`, msg);
        }
        this.markLate(block, book, timing);
      }
    } catch (e) {
      console.error(`tick ${block}:`, (e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  /** Balance the account leverage cap reads: Bybit equity, or the dry run's own. */
  private equityUsd(): number {
    const a = this.market.account;
    if (this.market.wallet) return a && Number.isFinite(a.accountValue) ? a.accountValue : 0;
    return this.bankrollUsd + this.totals.pnlUsd;
  }

  /** Entries one position may take: the strategy's first plus its adds. A model without adds has one. */
  private entrySlots(): number {
    return config.model === "strategy" ? 1 + config.strategyMaxAdds : 1;
  }

  private isStale(): boolean {
    const at = this.market.bookAt;
    return at != null && at > 0 && Date.now() - at > config.riskStaleMs;
  }

  /**
   * The risk watchdog, on its own timer (RISK_CHECK_MS), apart from the model's tick. It is
   * never overruled: when a rule says close, the whole position goes as an IOC exit, the
   * model is told, and the event says the watchdog made the call. `nextBlock` gives the
   * close its own row. With a wallet it also keeps Bybit's server-side stop in place.
   */
  async riskTick(nextBlock: () => number) {
    this.syncFromVenue();
    const stale = this.isStale();
    if (stale !== this.stale) {
      this.stale = stale;
      console.log(`${this.market.label} risk: ${stale ? `book is stale (over ${config.riskStaleMs / 1000}s), new entries wait` : "book is fresh again"}`);
    }
    const sz = this.position.sz;
    const side = sz > 0 ? "long" : "short";
    const entry = this.entryPrice();
    if (this.market.wallet && this.market.setStopLoss) {
      await this.market.setStopLoss(sz && entry != null ? riskStopPrice(side, entry, config.riskStopPct) : null);
    }
    const rules = { stopPct: config.riskStopPct, volumeRatio: config.riskVolumeRatio };
    if (!sz || entry == null || stale || Date.now() < this.riskBusyUntil) return;
    if (rules.stopPct == null && rules.volumeRatio == null) return;
    let book: Book;
    try {
      book = this.market.readBook();
    } catch {
      return;
    }
    const turnover = rules.volumeRatio != null ? this.market.bars("15m").map((b) => b.turnover ?? Number.NaN) : null;
    const hit = riskCheck(rules, { side, entryPx: entry }, book.mid, turnover);
    if (!hit) return;
    this.riskBusyUntil = Date.now() + Math.max(15_000, config.riskCheckMs * 3);
    const block = nextBlock();
    console.log(`${this.market.label} #${block} RISK ${hit.rule}: ${hit.reason}, closing ${side} ${Math.abs(sz)}`);
    this.model.riskClosed?.(side);
    const decision: ModelDecision = {
      action: sz > 0 ? "sell" : "buy",
      intent: "close",
      bias: side,
      leverage: this.market.account?.leverage ?? 1,
      probabilities: { buy: 0, sell: 0, hold: 0, long: 0, short: 0, open: 0, close: 1 },
      upIn10: 0.5,
      latencyMs: 0,
      inputTokens: 0,
      risk: { rule: hit.rule, reason: hit.reason },
    };
    this.riskBlocks.set(block, hit.rule);
    this.emit(block, { ...book, block }, decision, null, false);
    this.enqueueQuote(block, decision, { side: sz > 0 ? "sell" : "buy", size: Math.abs(sz), reduceOnly: true, taker: true }, book, hit.rule);
  }

  private enqueueQuote(block: number, decision: ModelDecision, plan: QuotePlan, book: Book, risk?: RiskRule) {
    const seq = ++this.sendSeq;
    this.exchangeTail = this.exchangeTail.catch(() => {}).then(async () => {
      if (seq !== this.sendSeq) return;
      // An exit skips the leverage write: nothing about it depends on margin, and
      // the extra round trip is pure delay on the one order that has to land now.
      if (!plan.taker) {
        await this.market.setLeverage(decision.leverage);
        if (seq !== this.sendSeq) return;
      }
      const cancel = [...this.orders.keys()].filter((id) => id > 0);
      const quote = await this.market.send(plan.side, plan.size, book, cancel, plan.reduceOnly, plan.taker, risk);
      if (seq !== this.sendSeq) return;
      this.applyPosted(block, quote);
    });
  }

  /** Jev held. Pull the standing quote so an order it no longer wants cannot get hit. */
  private enqueueStandDown() {
    const seq = ++this.sendSeq;
    this.exchangeTail = this.exchangeTail.catch(() => {}).then(async () => {
      if (seq !== this.sendSeq) return;
      await this.market.cancelResting();
      if (seq !== this.sendSeq) return;
      this.orders.clear();
    });
  }

  private markLate(block: number, book: Book | null, timing?: Timing) {
    this.totals.lateBlocks++;
    if (book) this.emit(block, book, null, null, true, timing);
  }

  private applyPosted(block: number, quote: Quote) {
    const e = this.history.find((h) => h.block === block);
    if (e) e.quote = quote;
    if (!quote.unchanged) this.totals.quotes++;
    if (quote.status === "reverted") this.totals.reverted++;
    if (quote.taker) {
      // An Ioc never rests. Live fills arrive on userFills; a dry run fills here.
      this.orders.clear();
      if (quote.status === "sim") this.simTakerFill(block, quote);
    } else if (quote.status === "sim") {
      this.orders.clear();
      this.orders.set(--this.simId, { side: quote.side, price: quote.price, size: quote.size, block });
    } else if (quote.status === "placed" && quote.orderId != null) {
      this.orders.clear();
      this.orders.set(quote.orderId, { side: quote.side, price: quote.price, size: quote.size, block });
    }
    this.onQuote(block, quote);
  }

  /** A dry-run exit crosses the touch, so it fills now rather than waiting on a print. */
  private simTakerFill(block: number, quote: Quote) {
    const fill: Fill = {
      side: quote.side,
      size: quote.size,
      price: quote.price,
      txHash: null,
      orderId: --this.simId,
      simulated: true,
      dir: quote.reduceOnly ? "close" : "open",
      feeUsd: quote.price * quote.size * config.simTakerFee,
    };
    this.applyFill(fill);
    this.recordFill(block, fill);
  }

  private harvest() {
    if (!this.trades) return;
    const prints = this.trades.drainPrints();
    // A dry run fill rested post-only, so it pays the maker fee.
    const fills = this.market.wallet
      ? takeLiveFills(this.orders, this.trades.drainFills())
      : takeSimFills(this.orders, prints).map((f) => ({ ...f, feeUsd: f.price * f.size * config.simMakerFee }));
    if (!fills.length) return;
    const byBlock = new Map<number, Fill[]>();
    for (const f of fills) {
      this.applyFill(f);
      byBlock.set(f.block, [...(byBlock.get(f.block) ?? []), f]);
    }
    for (const [block, fs] of byBlock) this.recordFill(block, aggregateFills(fs));
    this.market.refresh().catch(() => {});
  }

  private recordFill(block: number, fill: Fill) {
    const e = this.history.find((h) => h.block === block);
    // Slippage against the mid the order was decided at.
    const slip = e ? slipBps(fill.side, fill.price, e.mid) : null;
    if (e && slip != null) Object.assign(fill, { refPx: e.mid, slipBps: slip });
    const risk = this.riskBlocks.get(block);
    if (risk) fill.risk = risk;
    if (e) e.fill = fill;
    this.ledger.push({ ts: Date.now(), fill });
    if (this.ledger.length > 5000) this.ledger.shift();
    this.onFill(block, fill);
  }

  /** The numbers the daily report takes the difference of. */
  dailyMark() {
    const a = this.market.account;
    const mid = this.lastBook?.mid ?? 0;
    const equity = this.market.wallet ? (a?.accountValue ?? 0) : this.bankrollUsd + this.totals.pnlUsd;
    const sz = this.position.sz;
    return {
      at: Date.now(),
      equityUsd: round(equity, 2),
      realizedUsd: this.totals.realizedUsd,
      feesUsd: this.totals.gasUsd,
      position: sz ? { side: (sz > 0 ? "long" : "short") as "long" | "short", size: Math.abs(sz), entryPx: this.entryPrice()!, mid } : null,
    };
  }

  private restingSz(side: Side) {
    let sz = 0;
    for (const o of this.orders.values()) if (o.side === side) sz += o.size;
    return sz;
  }

  private buildState(block: number, book: Book): TradeState {
    this.syncFromVenue();
    const m = this.mids, n = m.length, H = config.horizonBlocks;
    const ret = (k: number) => (n > k ? ((m[n - 1]! - m[n - 1 - k]!) / m[n - 1 - k]!) * 10_000 : 0);
    const sampled = m.slice(-H).filter((_, i, a) => (a.length - 1 - i) % 5 === 0);
    const lvl = (l: [number, number]) => `${l[0].toFixed(6)} x ${round(l[1], 1)}`;
    const depth: TradeState["depth"] = {};
    for (const [k, v] of Object.entries(book.depthBps)) depth[k + "bps"] = { bid: round(v.bid, 1), ask: round(v.ask, 1) };
    const posSz = this.position.sz;
    const a = this.market.account;
    const entry = this.entryPrice();
    const unrealized = a ? a.unrealizedUsd : this.unrealizedUsd(book.mid);
    const indicators = snapNums(snapshotIndicators(this.market.candleCloses(80), book.mid));
    const asset = snapNums(venueFeatures(this.market.assetCtx, book.mid));
    return {
      coin: this.market.coin,
      market: this.market.pair,
      tick: block,
      tickMs: config.tickMs,
      mid: book.mid,
      spreadBps: round(book.spreadBps, 2),
      bookImbalance: round(book.imbalance, 3),
      depth,
      book: { bids: book.levels.bids.map(lvl), asks: book.levels.asks.map(lvl) },
      returnsBps: { last1: round(ret(1), 2), last5: round(ret(5), 2), last20: round(ret(20), 2), last100: round(ret(100), 2) },
      recentMids: sampled.map((x) => x.toFixed(6)).join(" "),
      trades: this.trades ? this.trades.summary(H, block) : emptySummary(),
      recentTrades: (this.trades?.recent(10) ?? []).map((t) => `${t.block} ${t.side} ${round(t.size, 1)} @ ${t.price.toFixed(6)}`),
      position: {
        coin: this.market.coin,
        side: posSz > 0 ? "long" : posSz < 0 ? "short" : "flat",
        size: round(Math.abs(posSz), 8),
        notionalUsd: round(Math.abs(posSz) * book.mid, 4),
        entry,
        leverage: a?.leverage ?? null,
        liquidationPx: a?.liquidationPx ?? null,
        distanceBps: rnull(bpsBetween(entry, book.mid), 2),
        unrealizedUsd: round(unrealized, 4),
      },
      indicators,
      asset: { ...asset, maxLeverage: this.market.maxLeverage },
      maxLeverage: this.market.maxLeverage,
    };
  }

  private applyFill(f: Fill) {
    if (f.size <= 0) return;
    if (this.market.account) return;
    this.totals.fills++;
    const signed = f.side === "buy" ? f.size : -f.size;
    const p = this.position;
    if (p.sz === 0 || Math.sign(p.sz) === Math.sign(signed)) {
      p.costUsd += signed * f.price;
    } else {
      const closing = Math.min(Math.abs(signed), Math.abs(p.sz)) * Math.sign(signed);
      const entry = p.costUsd / p.sz;
      this.totals.realizedUsd += -closing * (f.price - entry);
      p.costUsd += closing * entry;
      const remainder = signed - closing;
      p.costUsd += remainder * f.price;
    }
    p.sz += signed;
    if (Math.abs(p.sz) < 1e-9) { p.sz = 0; p.costUsd = 0; }
    if (f.feeUsd) this.totals.gasUsd += f.feeUsd;
  }

  private syncFromVenue() {
    const a = this.market.account;
    if (!a) return;
    this.position.sz = a.positionSz;
    this.position.costUsd = a.entryPrice != null && a.positionSz ? a.entryPrice * a.positionSz : 0;
    this.totals.realizedUsd = a.realizedUsd;
    this.totals.gasUsd = a.feesUsd;
    this.totals.fills = this.market.fillPrints.length;
  }

  /**
   * Bybit equity when there is a wallet. A dry run has none, so it reports its own:
   * the starting share plus PnL after fees, and free balance net of the open margin.
   */
  private balance(a: VenueMarket["account"], size: number, mid: number, leverage: number | null) {
    if (this.market.wallet) {
      return {
        accountValue: a && Number.isFinite(a.accountValue) ? round(a.accountValue, 2) : null,
        withdrawable: a && Number.isFinite(a.withdrawable) ? round(a.withdrawable, 2) : null,
      };
    }
    const equity = this.bankrollUsd + this.totals.pnlUsd;
    const margin = size && mid ? (size * mid) / Math.max(1, leverage ?? 1) : 0;
    return { accountValue: round(equity, 2), withdrawable: round(Math.max(0, equity - margin), 2) };
  }

  private entryPrice() { return this.position.sz ? this.position.costUsd / this.position.sz : null; }
  private unrealizedUsd(mid: number) { return this.position.sz ? this.position.sz * (mid - this.entryPrice()!) : 0; }

  private emit(block: number, book: Book, decision: ModelDecision | null, quote: Quote | null, late: boolean, timing?: Timing) {
    this.syncFromVenue();
    const t = this.totals;
    t.gasSz = book.mid ? t.gasUsd / book.mid : 0;
    const a = this.market.account;
    const unrealized = a ? a.unrealizedUsd : this.unrealizedUsd(book.mid);
    t.pnlUsd = t.realizedUsd + unrealized - t.gasUsd;
    t.pnlSz = t.pnlUsd / book.mid;
    t.pnlPct = (t.pnlUsd / (a?.accountValue || this.bankrollUsd || 1)) * 100;
    const size = Math.abs(this.position.sz);
    const event: BlockEvent = {
      coin: this.market.coin,
      block, ts: Date.now(), mid: book.mid, bestBid: book.bid, bestAsk: book.ask, spreadBps: round(book.spreadBps, 2),
      decision: late
        ? { action: "hold", probabilities: { buy: 0, sell: 0, hold: 1 }, upIn10: 0.5, latencyMs: 0, late: true }
        : decision && {
          action: decision.action,
          intent: decision.intent,
          bias: decision.bias,
          leverage: decision.leverage,
          probabilities: decision.probabilities,
          upIn10: decision.upIn10,
          latencyMs: Math.round(decision.latencyMs),
          ...(decision.closeFraction ? { closeFraction: decision.closeFraction } : {}),
          ...(decision.risk ? { risk: decision.risk } : {}),
          late: false,
        },
      quote,
      fill: null,
      resting: { bidSz: round(this.restingSz("buy"), this.market.szDecimals), askSz: round(this.restingSz("sell"), this.market.szDecimals) },
      position: {
        side: this.position.sz > 0 ? "long" : this.position.sz < 0 ? "short" : "flat",
        size,
        entryPrice: this.entryPrice(),
        leverage: a?.leverage ?? decision?.leverage ?? null,
        unrealizedUsd: round(unrealized, 6),
        unrealizedSz: round(unrealized / book.mid, 8),
      },
      totals: { ...t, jevUsd: round(t.jevUsd, 6), gasSz: round(t.gasSz, 8), gasUsd: round(t.gasUsd, 6), realizedUsd: round(t.realizedUsd, 6), pnlUsd: round(t.pnlUsd, 6), pnlSz: round(t.pnlSz, 8), pnlPct: round(t.pnlPct, 4) },
      ...(!late && decision?.levels ? { levels: decision.levels } : {}),
      ...this.balance(a, size, book.mid, a?.leverage ?? decision?.leverage ?? null),
    };
    this.history.push(event);
    if (this.history.length > config.historySize) this.history.shift();
    this.onEvent(event, timing);
  }
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const rnull = (x: number | null, d: number) => (x == null || !Number.isFinite(x) ? null : round(x, d));

function snapNums<T extends Record<string, number | null>>(obj: T): T {
  const out = { ...obj };
  for (const [k, v] of Object.entries(out)) {
    (out as Record<string, number | null>)[k] = typeof v === "number" ? round(v, 6) : v;
  }
  return out;
}
