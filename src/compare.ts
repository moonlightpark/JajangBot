/**
 * Side by side: the strategy bot and the Jev bot, both dry run.
 *
 *   bun run start          # strategy, :3000
 *   bun run start:jev      # Jev, :3002 (needs TYPESAFE_API_KEY or AI_GATEWAY_API_KEY)
 *   bun run compare
 *
 * Bot URLs: COMPARE_A (default http://localhost:3000), COMPARE_B (default http://localhost:3002).
 * "live pnl" is since that bot started, after fees. The strategy bot's balance also holds its
 * closed backtest PnL, shown apart, so compare live pnl, not balance.
 */
import type { BlockEvent, Meta } from "./types";

type Root = Meta & { latestByCoin: Record<string, BlockEvent | null> };

const bots = [process.env.COMPARE_A ?? "http://localhost:3000", process.env.COMPARE_B ?? "http://localhost:3002"];

async function read(url: string): Promise<Root | string> {
  try {
    const r = await fetch(`${url}/`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return `HTTP ${r.status}`;
    return (await r.json()) as Root;
  } catch {
    return "not running";
  }
}

const usd = (x: number) => `${x < 0 ? "-" : "+"}$${Math.abs(x).toFixed(2)}`;
const hours = (ms: number) => `${(ms / 3_600_000).toFixed(1)}h`;
const who = (m: string) => (m === "jev" ? "Jev" : m === "strategy" ? "strategy" : m);

const rows: string[][] = [["", ...bots]];
const cols = await Promise.all(bots.map(read));
const field = (label: string, f: (r: Root) => string) => rows.push([label, ...cols.map((c) => (typeof c === "string" ? c : f(c)))]);
const sum = (r: Root, f: (e: BlockEvent) => number) => Object.values(r.latestByCoin).reduce((s, e) => s + (e ? f(e) : 0), 0);

field("decides", (r) => `${who(r.model)}${r.dryRun ? ", dry run" : ""}`);
field("running", (r) => hours(Date.now() - r.startedAt));
field("balance", (r) => `$${sum(r, (e) => e.accountValue ?? 0).toFixed(2)}`);
field("  backtest in it", (r) => usd(r.sleeves.reduce((s, x) => s + (x.backtestUsd ?? 0), 0)));
field("live pnl", (r) => usd(sum(r, (e) => e.totals.pnlUsd)));
field("  realized", (r) => usd(sum(r, (e) => e.totals.realizedUsd)));
field("  unrealized", (r) => usd(sum(r, (e) => e.position.unrealizedUsd)));
field("  fees", (r) => `$${sum(r, (e) => e.totals.gasUsd).toFixed(2)}`);
field("fills", (r) => String(sum(r, (e) => e.totals.fills)));
field("decisions", (r) => String(sum(r, (e) => e.totals.decisions)));
field("late ticks", (r) => String(sum(r, (e) => e.totals.lateBlocks)));
field("Jev cost", (r) => `$${sum(r, (e) => e.totals.jevUsd).toFixed(4)}`);
field("open", (r) =>
  Object.values(r.latestByCoin)
    .filter((e): e is BlockEvent => !!e && e.position.side !== "flat")
    .map((e) => `${e.coin} ${e.position.side}`)
    .join(" ") || "none");

const width = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
for (const r of rows) console.log(r.map((c, i) => c.padEnd(width[i]!)).join("  "));
console.log("\nlive pnl is since each bot started, after fees. Compare it over the same hours; balance also holds the strategy backtest.");
