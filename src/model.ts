import { experimental_evaluate as evaluate } from "ai";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { assertJevCredentials, config } from "./config";
import { clampLeverage, leverageRungs, liveIntent, parseLeverage, quoteAction, type Bias, type Intent } from "./plan";
import type { Ohlc } from "./chart";
import { closedBars, MAGINGA, magingaLines, rearm, strategyCall, swingLevel, trackEntries, withLiveBar, type EntryLog, type MagingaParams, type StrategyRules } from "./strategy";
import type { Action, Side, StrategyLevels } from "./types";

/** What the model sees. Compact, relative, human-readable. */
export interface TradeState {
  coin: string;
  market: string;
  tick: number;
  tickMs: number;
  mid: number;
  spreadBps: number;
  bookImbalance: number;
  /** Cumulative resting size within 10/25/50 bps of mid, per side. */
  depth: { [band: string]: { bid: number; ask: number } };
  /** Top 5 levels each side, best first, as "price x size". */
  book: { bids: string[]; asks: string[] };
  returnsBps: { last1: number; last5: number; last20: number; last100: number };
  recentMids: string;
  /** Taker prints in the lookback window. cvdSz = taker buy size minus taker sell size. */
  trades: { count: number; buySz: number; sellSz: number; cvdSz: number; vwap: number | null; lastPrice: number | null; lastSide: Side | null };
  recentTrades: string[];
  position: {
    coin: string;
    side: "long" | "short" | "flat";
    size: number;
    notionalUsd: number;
    entry: number | null;
    leverage: number | null;
    liquidationPx: number | null;
    distanceBps: number | null;
    unrealizedUsd: number;
  };
  indicators: {
    sma20: number | null;
    sma50: number | null;
    ema20: number | null;
    midVsSma20Bps: number | null;
    midVsSma50Bps: number | null;
    rsi14: number | null;
    vol20Bps: number | null;
    high20: number | null;
    low20: number | null;
    rangePos20: number | null;
  };
  asset: {
    markPx: number | null;
    oraclePx: number | null;
    fundingBps: number | null;
    premiumBps: number | null;
    openInterest: number | null;
    dayNtlVlmUsd: number | null;
    dayChangeBps: number | null;
    maxLeverage: number;
  };
  maxLeverage: number;
}

export interface ModelDecision {
  action: Action;
  intent: Intent;
  bias: Bias;
  leverage: number;
  probabilities: {
    buy: number;
    sell: number;
    hold: number;
    long: number;
    short: number;
    open: number;
    close: number;
  };
  upIn10: number;
  latencyMs: number;
  inputTokens: number;
  /** MODEL=strategy only: the channel lines this call was made against. */
  levels?: StrategyLevels;
  /** A close of only this share of the position (partial take profit). Left out: all of it. */
  closeFraction?: number;
}

export interface Model {
  readonly name: string;
  decide(state: TradeState): Promise<ModelDecision>;
}

/** Book, tape, and the open position. Wallet fills and lifetime PnL stay off this object. */
export function marketFacing(state: TradeState) {
  const pos = state.position;
  return {
    coin: state.coin,
    market: state.market,
    tick: state.tick,
    tickMs: state.tickMs,
    mid: state.mid,
    spreadBps: state.spreadBps,
    bookImbalance: state.bookImbalance,
    depth: state.depth,
    book: state.book,
    returnsBps: state.returnsBps,
    recentMids: state.recentMids,
    trades: state.trades,
    recentTrades: state.recentTrades,
    position: {
      coin: pos.coin,
      side: pos.side,
      size: pos.size,
      notionalUsd: pos.notionalUsd,
      entry: pos.entry,
      leverage: pos.leverage,
      liquidationPx: pos.liquidationPx,
      distanceBps: pos.distanceBps,
      ...(pos.side === "flat" ? {} : { unrealizedUsd: pos.unrealizedUsd }),
    },
    indicators: state.indicators,
    asset: state.asset,
    maxLeverage: state.maxLeverage,
  };
}

/** Labels and live fields only. No advice about when to pick an action. */
export function jevQuestions(state: TradeState) {
  const asset = state.coin;
  const pos = state.position;
  const stance = pos.side === "flat"
    ? `flat ${asset}`
    : `${pos.side} ${pos.size} ${asset} @ ${pos.entry ?? "?"}`;
  const levNow = pos.leverage != null ? `${pos.leverage}x` : "unset";
  const rungs = leverageRungs(state.maxLeverage);
  const levCriteria: Record<string, string> = {};
  for (const n of rungs) {
    levCriteria[String(n)] = `${n}x`;
  }
  const ctx = `${asset} ${state.market}. position has side/size/entry. indicators are 1m sma/ema/rsi/vol. asset is mark/oracle/funding/oi. trades and book are the tape.`;
  const bias = {
    type: "choice",
    instructions: {
      question: `long or short ${asset}?`,
      goal: `${state.market}`,
      timing: `tickMs=${state.tickMs}. position=${stance}.`,
      inputs: ctx,
    },
    criteria: {
      long: "long",
      short: "short",
    },
  };
  const leverage = {
    type: "choice",
    instructions: {
      question: `cross leverage for ${asset}?`,
      goal: `current ${levNow}. max ${state.maxLeverage}x.`,
      timing: `rungs ${rungs.join(" ")}`,
      inputs: ctx,
    },
    criteria: levCriteria,
  };
  if (pos.side === "flat") {
    return {
      bias,
      intent: {
        type: "choice",
        instructions: {
          question: `open or hold ${asset}?`,
          goal: `position=${stance}.`,
          timing: `tickMs=${state.tickMs}`,
          inputs: ctx,
        },
        criteria: {
          open: "open",
          hold: "hold",
        },
      },
      leverage,
    };
  }
  return {
    bias,
    intent: {
      type: "choice",
      instructions: {
        question: `open, close, or hold ${asset}?`,
        goal: `position=${stance}.`,
        timing: `tickMs=${state.tickMs}`,
        inputs: ctx,
      },
      criteria: {
        open: "open",
        close: "close",
        hold: "hold",
      },
    },
    leverage,
  };
}

interface Packed {
  intent: Intent;
  bias: Bias;
  leverage: number;
  longP: number;
  shortP: number;
  openP: number;
  closeP: number;
  holdP: number;
  latencyMs: number;
  inputTokens: number;
}

function pack(o: Packed): ModelDecision {
  const action = quoteAction(o.intent, o.bias);
  // long/short and open/close/hold are each a distribution. buy/sell are the legacy
  // pair: the mass behind the order actually being sent, discounted by the hold mass.
  const conviction = action === "buy"
    ? Math.max(o.longP, o.openP)
    : action === "sell"
      ? Math.max(o.shortP, o.closeP)
      : 0;
  const sized = conviction * (1 - o.holdP);
  return {
    action,
    intent: o.intent,
    bias: o.bias,
    leverage: o.leverage,
    probabilities: {
      buy: action === "buy" ? sized : 0,
      sell: action === "sell" ? sized : 0,
      hold: o.holdP,
      long: o.longP,
      short: o.shortP,
      open: o.openP,
      close: o.closeP,
    },
    upIn10: o.longP,
    latencyMs: o.latencyMs,
    inputTokens: o.inputTokens,
  };
}

function normChoice(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  const n = normChoice(raw);
  return (allowed as readonly string[]).includes(n) ? n as T : fallback;
}

function pickKnown<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  const n = normChoice(raw);
  return (allowed as readonly string[]).includes(n) ? n as T : null;
}

/** Normalize a choice answer over `keys`. Missing probabilities fall back to the pick. */
function choiceProbs(answer: ChoiceAnswer | undefined, keys: readonly string[]): Record<string, number> {
  const choice = normChoice(answer?.choice);
  const p = answer?.probabilities ?? {};
  const raw = keys.map((k) => Math.max(0, p[k] ?? (choice === k ? 1 : 0)));
  const sum = raw.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  if (sum <= 0) {
    const at = keys.indexOf(choice);
    if (at < 0) {
      keys.forEach((k) => { out[k] = 1 / keys.length; });
      return out;
    }
    keys.forEach((k, i) => { out[k] = i === at ? 1 : 0; });
    return out;
  }
  keys.forEach((k, i) => { out[k] = raw[i]! / sum; });
  return out;
}

type ChoiceAnswer = { choice?: string; probabilities?: Record<string, number> };
type JevAnswers = { bias?: ChoiceAnswer; intent?: ChoiceAnswer; leverage?: ChoiceAnswer };

/** Map a Jev answer set onto one tick. A side we cannot read is a hold, not a long. */
export function decideFromJevAnswers(
  answers: JevAnswers,
  positionSide: "long" | "short" | "flat",
  maxLeverage: number,
  currentLeverage: number | null,
  latencyMs = 0,
  inputTokens = 0,
): ModelDecision {
  const flat = positionSide === "flat";
  const biasPick = pickKnown(answers.bias?.choice, ["long", "short"] as const);
  const choices = flat ? (["open", "hold"] as const) : (["open", "close", "hold"] as const);
  const intent = liveIntent(positionSide, biasPick ? pick(answers.intent?.choice, choices, "hold") : "hold");
  const dir = choiceProbs(answers.bias, ["long", "short"]);
  const act = choiceProbs(answers.intent, choices);
  return pack({
    intent,
    bias: biasPick ?? "long",
    leverage: parseLeverage(answers.leverage?.choice, maxLeverage, currentLeverage ?? 1),
    longP: dir.long!,
    shortP: dir.short!,
    openP: act.open!,
    closeP: act.close ?? 0,
    holdP: act.hold!,
    latencyMs,
    inputTokens,
  });
}

let typesafe: TypeSafeClient | undefined;

function typesafeClient(): TypeSafeClient {
  return (typesafe ??= new TypeSafeClient({
    apiKey: process.env.TYPESAFE_API_KEY,
    defaultModel: config.jevModelId,
    retry: { maxRetries: 0 },
  }));
}

const JEV_DEADLINE_MS = 4000;

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`jev timeout ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function callJev(state: TradeState): Promise<{ answers: JevAnswers; inputTokens: number }> {
  const seen = marketFacing(state);
  const qs = jevQuestions(state);
  const run = async () => {
    if (config.jevProvider === "gateway") {
      const r = await evaluate({
        model: config.jevModelId,
        state: seen as never,
        questions: qs,
        maxRetries: 0,
      });
      return { answers: r.answers, inputTokens: r.usage?.inputTokens ?? 0 };
    }
    const r = await typesafeClient().systemOne(
      {
        model: config.jevModelId,
        state: seen as never,
        questions: qs,
      },
      { retry: { maxRetries: 0 } },
    );
    return { answers: r.answers, inputTokens: r.usage.input_tokens ?? 0 };
  };
  return withDeadline(run(), JEV_DEADLINE_MS);
}

/** Real Jev. JEV_PROVIDER selects official TypeSafe or Vercel AI Gateway. */
export class JevModel implements Model {
  readonly name = "jev";

  async decide(state: TradeState): Promise<ModelDecision> {
    const t0 = performance.now();
    const r = await callJev(state);
    return decideFromJevAnswers(
      r.answers,
      state.position.side,
      state.maxLeverage,
      state.position.leverage,
      performance.now() - t0,
      r.inputTokens,
    );
  }
}

/** Deterministic stand-in: momentum + imbalance. Jev-shaped open/close/hold/long/short/leverage. */
export class MockModel implements Model {
  readonly name = "mock";

  async decide(state: TradeState): Promise<ModelDecision> {
    const t0 = performance.now();
    const flow = state.trades.buySz + state.trades.sellSz ? state.trades.cvdSz / (state.trades.buySz + state.trades.sellSz) : 0;
    const signal = state.returnsBps.last20 / 8 + state.bookImbalance * 1.5 + flow * 2 + this.noise(state.tick);
    const longP = 1 / (1 + Math.exp(-signal));
    const bias: Bias = longP >= 0.5 ? "long" : "short";
    const against = (bias === "long" && state.position.side === "short") || (bias === "short" && state.position.side === "long");
    // A weak signal is not worth a round trip, so stand down instead of forcing a side.
    const weak = Math.abs(signal) < 0.35;
    const picked: Intent = against ? "close" : weak ? "hold" : "open";
    const intent = liveIntent(state.position.side, picked);
    const holdP = intent === "hold" ? 0.7 : 0.15;
    const closeP = intent === "close" ? 0.7 : 0.15;
    const leverage = parseLeverage(1 + Math.abs(signal) * 8, state.maxLeverage, state.position.leverage ?? 1);
    await Bun.sleep(80);
    return pack({
      intent,
      bias,
      leverage,
      longP,
      shortP: 1 - longP,
      openP: Math.max(0, 1 - holdP - closeP),
      closeP,
      holdP,
      latencyMs: performance.now() - t0,
      inputTokens: Math.round(JSON.stringify(state).length / 4),
    });
  }

  private noise(tick: number) {
    let h = tick * 2654435761 >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    return ((h % 1000) / 1000 - 0.5) * 3;
  }
}

/** The strategy variant the bot runs, from .env. The backtest and the chart lines use the same. */
export const liveStrategy: { params: MagingaParams; rules: StrategyRules } = {
  params: { ...MAGINGA, emaLen: config.strategyEmaLen },
  rules: {
    stopPct: config.strategyStopPct,
    exit: config.strategyExit,
    onBarClose: config.strategyOnBarClose,
    exitLive: config.strategyExitLive,
    partialTp: config.strategyPartialTp,
    swingStop: config.strategySwingStop,
    firstPriceTp: config.strategyFirstPriceTp,
    maxAdds: config.strategyMaxAdds,
    addGapBars: config.strategyAddGapBars,
  },
};

/** "EMA 200, stop 5%, exit mid, bar close" for logs. Only the parts that differ from the script. */
export function describeStrategy(s = liveStrategy): string {
  const parts = [`EMA ${s.params.emaLen}`];
  if (s.rules.stopPct) parts.push(`stop ${+(s.rules.stopPct * 100).toFixed(2)}%`);
  if (s.rules.exit !== "opposite") parts.push(`exit ${s.rules.exit}`);
  if (s.rules.onBarClose) parts.push("bar close");
  if (s.rules.exitLive) parts.push("live take profit");
  if (s.rules.firstPriceTp) parts.push(`take ${+(s.rules.firstPriceTp * 100).toFixed(2)}% at entry 1 price after entry ${1 + s.rules.maxAdds}`);
  if (s.rules.swingStop) parts.push(`swing stop after entry ${1 + s.rules.maxAdds}`);
  if (s.rules.partialTp) parts.push(`take ${+(s.rules.partialTp * 100).toFixed(2)}% at middle`);
  if (s.rules.maxAdds) parts.push(`adds ${s.rules.maxAdds} after ${s.rules.addGapBars.join("/")} bars`);
  return parts.join(", ");
}

/**
 * User strategy: the TradingView "[GaYang] Maginga 15Ho" channel rules (src/strategy.ts),
 * with the STRATEGY_* variant on top. Code makes the call here, not Jev. It decides every
 * tick: on the forming bar, or with onBarClose on the last closed bar, which holds the
 * call steady until the next 15m close.
 */
export class StrategyModel implements Model {
  readonly name = "strategy";
  private lastReason = "";
  /** The side a stop just closed. See `rearm`. */
  private blocked: "long" | "short" | null = null;
  /** Entries into the open position, read off the position each tick. Gates adds. */
  private entries: EntryLog | null = null;

  constructor(
    /** 15m candles, oldest first. */
    private bars: () => Ohlc[],
    private leverage: number = config.strategyLeverage,
    private now: () => number = Date.now,
    private strategy = liveStrategy,
  ) {}

  async decide(state: TradeState): Promise<ModelDecision> {
    const t0 = performance.now();
    const { params: p, rules } = this.strategy;
    const side = state.position.side;
    const now = this.now();
    this.entries = trackEntries(this.entries, side, state.position.size, now);
    // The first entry's price: the average while only one entry is in.
    if (this.entries && this.entries.count === 1 && this.entries.firstPx == null && state.position.entry) {
      this.entries = { ...this.entries, firstPx: state.position.entry };
    }
    // Swing stop: fix the level once the last entry is in, from the bars between the last two entries.
    const e = this.entries;
    if (rules.swingStop && e && side !== "flat" && e.count >= 1 + rules.maxAdds && e.level == null && e.prevTs != null) {
      const level = swingLevel(this.bars(), side, e.prevTs, e.lastTs, p.periodMs);
      if (level != null) {
        this.entries = { ...e, level };
        console.log(`${state.coin} strategy ${p.timeframe}: swing stop set at ${level} (entries ${e.count - 1} to ${e.count})`);
      }
    }
    const bars = rules.onBarClose ? closedBars(this.bars(), this.now(), p.periodMs) : withLiveBar(this.bars(), state.mid, this.now(), p.periodMs);
    const lines = magingaLines(bars, p);
    const last = bars.at(-1);
    let call = lines && last
      ? strategyCall(lines, last, side, state.mid, state.position.entry, rules, { entries: this.entries, now, periodMs: p.periodMs })
      : { intent: "hold" as Intent, bias: "long" as Bias, reason: `warming up (${bars.length}/${p.emaLen} bars)`, lines: null };
    if ("stopped" in call && call.stopped && side !== "flat") this.blocked = side;
    ({ call, blocked: this.blocked } = rearm(this.blocked, side === "flat", call));
    const intent = liveIntent(side, call.intent);
    if (call.reason !== this.lastReason) {
      this.lastReason = call.reason;
      const l = call.lines;
      const band = l ? ` (long < ${l.longLine.toFixed(6)}, short > ${l.shortLine.toFixed(6)})` : "";
      console.log(`${state.coin} strategy ${p.timeframe}: ${call.reason}${band}`);
    }
    const decision = pack({
      intent,
      bias: call.bias,
      // The set STRATEGY_LEVERAGE, not the nearest rung: 15 must not land on 10.
      leverage: clampLeverage(this.leverage, state.maxLeverage),
      // A hold takes no side, so do not show it as 100% long on the dashboard.
      longP: intent === "hold" ? 0.5 : call.bias === "long" ? 1 : 0,
      shortP: intent === "hold" ? 0.5 : call.bias === "short" ? 1 : 0,
      openP: intent === "open" ? 1 : 0,
      closeP: intent === "close" ? 1 : 0,
      holdP: intent === "hold" ? 1 : 0,
      latencyMs: performance.now() - t0,
      inputTokens: 0,
    });
    if (call.lines) decision.levels = { long: call.lines.longLine, short: call.lines.shortLine, timeframe: p.timeframe };
    if (intent === "close" && call.closeFraction) decision.closeFraction = call.closeFraction;
    return decision;
  }
}

/** MODEL=mock | jev | strategy. The strategy reads candles from the sleeve's market. */
export const createModel = (market?: { bars(bar: "1m" | "15m"): Ohlc[] }): Model => {
  if (config.model === "strategy") {
    if (!market) throw new Error("MODEL=strategy needs the market's candles");
    return new StrategyModel(() => market.bars("15m"));
  }
  if (config.model !== "jev") return new MockModel();
  assertJevCredentials(config.model, config.jevProvider, process.env);
  return new JevModel();
};
