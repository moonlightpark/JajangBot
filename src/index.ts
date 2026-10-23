import { assertJevCredentials, config } from "./config";
import { closedNetByCoin, readBacktestReport } from "./backtest";
import { refreshBacktest } from "./backtest-report";
import { createModel, describeStrategy } from "./model";
import { hasKeys, loadSleeves } from "./sleeves";
import { startServer, type SleeveView } from "./server";
import { Trader } from "./trader";
import type { BlockEvent, Fill, Meta, Quote, Timing } from "./types";
import { BybitFeed } from "./bybit-feed";
import { BybitMarket } from "./bybit-market";

// Without a Jev key every sleeve would fail and retry; say why once, up front.
assertJevCredentials(config.model, config.jevProvider, {
  TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
});

const specs = loadSleeves();
if (!specs.length) throw new Error("no sleeves");

const views: SleeveView[] = [];
const first = specs[0]!;
const meta: Meta = {
  model: config.model,
  wallet: null,
  dryRun: config.dryRun || specs.every((s) => !hasKeys(s)),
  virtual: { on: config.dryRun, toggle: !!config.adminToken, keys: specs.some(hasKeys) },
  market: first.pair,
  startedAt: Date.now(),
  venue: config.venue,
  network: config.bybitEnv,
  coin: first.coin,
  pair: first.pair,
  explorerTx: config.explorerTx,
  tickMs: config.tickMs,
  sleeves: [],
};

// A dry run's balance runs on from the backtest: each sleeve starts at its share of
// BANKROLL_USD plus the net of its closed backtest trades. A wallet uses Bybit's balance.
// The backtest replays the strategy, so only MODEL=strategy carries it; a Jev or mock
// bot starts flat at BANKROLL_USD, which keeps a side-by-side comparison even.
// The backtest is rerun up to this start first, so it ends where the bot's own calls begin.
const backtest = config.model === "strategy" ? await startupBacktest() : null;
const backtestNet = closedNetByCoin(backtest);

async function startupBacktest() {
  const t0 = Date.now();
  const run = await refreshBacktest(specs.map((s) => s.coin), meta.startedAt).catch((e: Error) => {
    console.log(`backtest: failed: ${e.message}`);
    return null;
  });
  if (!run) {
    const old = await readBacktestReport();
    if (old) console.log(`backtest: kept the saved run to ${new Date(old.to).toISOString().slice(0, 16)} UTC`);
    return old;
  }
  console.log(`backtest: ${new Date(run.report.from).toISOString().slice(0, 10)} to ${new Date(run.report.to).toISOString().slice(0, 16)} UTC in ${Date.now() - t0}ms`);
  return run.report;
}

let server: ReturnType<typeof startServer> | undefined;
const starters: Array<() => void> = [];

for (const spec of specs) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const feed = new BybitFeed(spec.coin);
      const market = new BybitMarket(feed, spec);
      feed.onPrice = (book) => {
        server?.broadcastPrice(spec.coin, {
          ts: Date.now(),
          mid: book.mid,
          bestBid: book.bid,
          bestAsk: book.ask,
          spreadBps: book.spreadBps,
        });
      };
      await feed.connect();
      await market.init();
      const trader = new Trader(
        market,
        createModel(market),
        onEvent(spec.coin),
        onFill(spec.coin),
        onQuote(spec.coin),
      );
      trader.attachTradeFeed(feed.trades);
      const dry = config.dryRun || !hasKeys(spec);
      // A dry run picks up the backtest's open position where the run ended. Its entry fees
      // were paid in the backtest, so they come off the balance now; the rest is the bot's PnL.
      // Only a run that reaches this start: a saved one kept after a failed rerun is stale.
      const fresh = backtest != null && meta.startedAt - backtest.to < 15 * 60_000;
      const open = dry && fresh ? backtest.openByCoin?.[spec.coin] : undefined;
      const carried = open && trader.carry(open) ? open : undefined;
      const btUsd = dry ? Math.round(((backtestNet[spec.coin] ?? 0) - (carried?.feesUsd ?? 0)) * 100) / 100 : 0;
      trader.bankrollUsd = config.bankrollUsd / specs.length + btUsd;
      if (carried) {
        console.log(`${spec.coin} carried the backtest's open ${carried.side} ${carried.size} @ ${carried.entryPx} (entry ${carried.count}, since ${new Date(carried.entryTs).toISOString().slice(0, 16)} UTC)`);
      }
      market.onVenueFill = (p) => {
        server?.broadcastFill(spec.coin, 0, {
          side: p.side,
          size: p.size,
          price: p.price,
          txHash: p.hash ?? null,
          orderId: 0,
          simulated: false,
          dir: p.dir,
        }, p.ts);
      };
      views.push({ coin: spec.coin, history: () => trader.history, tape: () => trader.tape });
      meta.sleeves.push({
        coin: spec.coin, pair: spec.pair, label: spec.label, wallet: market.address, backtestUsd: btUsd,
        ...(dry ? { startUsd: config.bankrollUsd / specs.length } : {}),
        ...(carried ? { carried } : {}),
      });
      if (spec === first) {
        meta.wallet = market.address;
        meta.coin = spec.coin;
        meta.pair = spec.pair;
        meta.market = spec.pair;
      }
      starters.push(() => feed.start((tick) => trader.onBlock(tick)));
      console.log(`sleeve ${spec.label} ${spec.pair} ${dry ? `DRY RUN, balance $${trader.bankrollUsd.toFixed(2)} (start $${(config.bankrollUsd / specs.length).toFixed(2)} + backtest $${btUsd.toFixed(2)})` : market.address}`);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await Bun.sleep(1000 * (attempt + 1));
    }
  }
  if (lastErr) console.error(`sleeve ${spec.label} failed: ${(lastErr as Error).message}`);
}

if (!views.length) throw new Error("no sleeves started");

server = startServer(meta, views);
for (const start of starters) start();

console.log(`jev-trade bybit ${config.bybitEnv} ${meta.sleeves.map((s) => s.label).join(" ")} model=${meta.model}${config.model === "jev" ? ` ${config.jevProvider}` : config.model === "strategy" ? ` 15m ${config.strategyLeverage}x (${describeStrategy()})` : ""} tick ${config.tickMs}ms price ${config.priceMs}ms quote $${config.quoteUsd} :${config.port}`);

function onEvent(coin: string) {
  return (e: BlockEvent, t?: Timing) => {
    server?.broadcast(e);
    if (e.decision && !e.decision.late) {
      const d = e.decision;
      const q = e.quote;
      // A hold applies neither bias nor leverage, and an exit skips the leverage write.
      const lev = d.intent === "open" && d.leverage != null ? ` ${d.leverage}x` : "";
      const call = d.intent === "hold" ? "hold" : d.intent && d.bias ? `${d.intent} ${d.bias}${lev}` : d.action;
      const order = q && ` ${q.side.toUpperCase()} ${q.size} @ ${q.price}${q.taker ? " cross" : ""}${q.reduceOnly ? " reduce" : ""}${q.unchanged ? " unchanged" : q.status === "sim" ? " (sim)" : ` ${q.status}`}`;
      const quote = order || (d.intent === "hold" ? " NO ORDER" : "");
      console.log(`${coin} #${e.block} ${e.mid} ${call} ${d.latencyMs}ms${quote} pnl $${e.totals.pnlUsd}${t ? ` loop ${t.loopMs}ms` : ""}`);
    }
  };
}

function onFill(coin: string) {
  return (block: number, fill: Fill) => {
    const kind = fill.dir === "open" ? "OPEN " : fill.dir === "close" ? "CLOSE " : fill.dir === "flip" ? "FLIP " : "";
    console.log(`${coin} #${block} ${kind}FILL ${fill.side} ${fill.size} @ ${fill.price}${fill.simulated ? " (sim)" : ""}`);
  };
}

function onQuote(coin: string) {
  return (block: number, quote: Quote) => {
    server?.broadcastQuote(coin, block, quote);
    if (quote.status !== "placed") console.log(`${coin} #${block} ${quote.status.toUpperCase()} ${quote.side} @ ${quote.price}`);
  };
}
