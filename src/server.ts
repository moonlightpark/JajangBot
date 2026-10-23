import { BACKTEST_LATEST } from "./backtest";
import { config } from "./config";
import { liveStrategy } from "./model";
import { tokenMatches, writeRuntime } from "./runtime";
import { magingaChannel } from "./strategy";
import { clipHistory, clipSnapshotTape, clipTape, TAPE_MIDS } from "./snapshot";
import type { BlockEvent, ChannelPoint, Fill, Meta, PricePoint, Quote } from "./types";

/** 8 significant digits: plenty for a chart line, and a third of the bytes. */
const sig = (x: number) => Number(x.toPrecision(8));

// "*" does not cover Authorization, which the 가상매매 switch sends.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const SNAP_MS = 400;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

function jsonMaybeGzip(req: Request, body: unknown, status = 200) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const accept = req.headers.get("accept-encoding") ?? "";
  if (accept.includes("gzip")) {
    return new Response(Bun.gzipSync(raw), {
      status,
      headers: {
        ...CORS,
        "content-type": "application/json",
        "content-encoding": "gzip",
        vary: "accept-encoding",
        "cache-control": "no-store",
      },
    });
  }
  return new Response(raw, {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

export type SleeveView = { coin: string; history: () => BlockEvent[]; tape: () => PricePoint[] };

/** The last `bun run backtest` run, read on each request so a new run shows without a restart. 404 until one exists. */
async function backtestReport(req: Request): Promise<Response> {
  // The backtest replays the strategy rules. Shown next to Jev's calls, it would read as Jev's.
  if (config.model !== "strategy") return json({ error: "the backtest is for MODEL=strategy" }, 404);
  const file = Bun.file(BACKTEST_LATEST);
  if (!(await file.exists())) return json({ error: "no backtest yet. Run bun run backtest" }, 404);
  return jsonMaybeGzip(req, await file.text());
}

/**
 * POST /virtual {on}: the dashboard's 가상매매 switch. Needs `Authorization: Bearer <ADMIN_TOKEN>`.
 * The setting goes to .runtime.json and the bot exits; systemd (Restart=always) starts it again,
 * so a switch to on reruns the backtest and carries on as a live dry run.
 */
async function setVirtual(req: Request, meta: Meta, restart: () => void): Promise<Response> {
  if (!config.adminToken) return json({ error: "ADMIN_TOKEN is not set on the bot" }, 403);
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!tokenMatches(config.adminToken, given)) {
    await Bun.sleep(1000);
    return json({ error: "wrong password" }, 401);
  }
  const body = (await req.json().catch(() => null)) as { on?: unknown } | null;
  if (typeof body?.on !== "boolean") return json({ error: "body must be {\"on\": true|false}" }, 400);
  if (!body.on && !meta.virtual?.keys) return json({ error: "no Bybit API key, so the bot cannot trade for real" }, 409);
  if (body.on === config.dryRun) return json({ on: body.on, restarting: false });
  writeRuntime({ dryRun: body.on });
  console.log(`가상매매 ${body.on ? "on" : "off"} from the dashboard, restarting`);
  // Let the reply go out first.
  setTimeout(restart, 300);
  return json({ on: body.on, restarting: true });
}

/** GET /snapshot, GET /history, GET /tape, GET /backtest, GET /levels, GET /events SSE, POST /virtual */
export function startServer(meta: Meta, sleeves: SleeveView[], restart: () => void = () => process.exit(0)) {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const enc = new TextEncoder();
  const send = (c: ReadableStreamDefaultController<Uint8Array>, type: string, data: unknown) => {
    try { c.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { clients.delete(c); }
  };
  setInterval(() => clients.forEach((c) => send(c, "ping", Date.now())), 15_000);

  const historyByCoin = () => {
    const out: Record<string, BlockEvent[]> = {};
    for (const s of sleeves) out[s.coin] = s.history();
    return out;
  };
  const tapeByCoin = () => {
    const out: Record<string, PricePoint[]> = {};
    for (const s of sleeves) out[s.coin] = clipTape(s.tape(), TAPE_MIDS);
    return out;
  };
  const snapshotBody = () => {
    const history: Record<string, BlockEvent[]> = {};
    const tape: Record<string, PricePoint[]> = {};
    for (const s of sleeves) {
      history[s.coin] = clipHistory(s.history());
      tape[s.coin] = clipSnapshotTape(s.tape());
    }
    return { ...meta, historyByCoin: history, tapeByCoin: tape };
  };
  /** MODEL=strategy channel over the whole 15m tape, for the chart. Empty for mock and jev. */
  const levelsByCoin = () => {
    const out: Record<string, ChannelPoint[]> = {};
    if (config.model !== "strategy") return out;
    for (const s of sleeves) {
      const bars = s.tape()
        .filter((p) => p.bar === "15m" && p.high != null && p.low != null)
        .map((p) => ({ ts: p.ts, open: p.open ?? p.mid, high: p.high!, low: p.low!, close: p.close ?? p.mid }))
        .sort((a, b) => a.ts - b.ts);
      out[s.coin] = magingaChannel(bars, liveStrategy.params).map((c) => ({ ts: c.ts, long: sig(c.long), short: sig(c.short) }));
    }
    return out;
  };
  const latestByCoin = () => {
    const out: Record<string, BlockEvent | null> = {};
    for (const s of sleeves) out[s.coin] = s.history().at(-1) ?? null;
    return out;
  };

  type SnapCache = { at: number; json: string; event: Uint8Array };
  let snapCache: SnapCache | null = null;
  const snap = (): SnapCache => {
    const now = Date.now();
    if (snapCache && now - snapCache.at < SNAP_MS) return snapCache;
    const body = JSON.stringify(snapshotBody());
    snapCache = { at: now, json: body, event: enc.encode(`event: snapshot\ndata: ${body}\n\n`) };
    return snapCache;
  };

  Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      if (pathname === "/") return json({ ...meta, latestByCoin: latestByCoin() });
      if (pathname === "/snapshot") return jsonMaybeGzip(req, snap().json);
      if (pathname === "/history") return jsonMaybeGzip(req, historyByCoin());
      if (pathname === "/tape") return jsonMaybeGzip(req, tapeByCoin());
      if (pathname === "/backtest") return backtestReport(req);
      if (pathname === "/levels") return jsonMaybeGzip(req, levelsByCoin());
      if (pathname === "/virtual" && req.method === "POST") return setVirtual(req, meta, restart);
      if (pathname === "/events") {
        const lite = url.searchParams.get("lite") === "1";
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            clients.add(c);
            if (lite) send(c, "ready", meta.startedAt);
            else {
              try { c.enqueue(snap().event); } catch { clients.delete(c); }
            }
          },
          cancel(c) { clients.delete(c); },
        });
        return new Response(stream, { headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
      }
      return json({ error: "not found" }, 404);
    },
  });

  const broadcast = (type: string, data: unknown) => clients.forEach((c) => send(c, type, data));
  return {
    broadcast: (e: BlockEvent) => broadcast("block", e),
    broadcastQuote: (coin: string, block: number, quote: Quote) => broadcast("quote", { coin, block, quote }),
    broadcastFill: (coin: string, block: number, fill: Fill, ts?: number) => broadcast("fill", { coin, block, fill, ts }),
    broadcastPrice: (coin: string, print: { ts: number; mid: number; bestBid: number; bestAsk: number; spreadBps: number }) =>
      broadcast("price", { coin, ...print }),
  };
}
