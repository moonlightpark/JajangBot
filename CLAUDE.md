---
description: Bun bot plus Next dashboard. Do not flatten the two runtimes.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

The bot is Bun. The dashboard is Next in `web/`. That split is intentional: keys, evaluate, and orders stay on the Bun process; the page is a live Next app. Do not fold the dashboard into Bun HTML imports unless you are merging deploys. Do not use Node, npm, pnpm, vite, or express for new work.

## Bot (repo root)

- `bun <file>` instead of `node` or `ts-node`
- `bun test` instead of jest or vitest
- `bun install` / `bun run <script>`
- `Bun.serve()` for the SSE API. WebSocket is built-in.
- Prefer `Bun.file` over `node:fs` read/write when touching new I/O
- Bun loads `.env`. Do not add dotenv.

Bot listens on `PORT` (default 3000). Dashboard `web/` is Next on 3001.

```sh
bun run start
bun run dev:web
```

## Dashboard (`web/`)

Next.js App Router. SSE client in `web/src/lib/useFeed.ts`. Wire types are `src/types.ts`. The dashboard keeps a copy in `web/src/lib/bot-types.ts` so the Vercel build does not need the repo root. Keep those two files identical. `bun test` diffs them.

## Session handoff

Work continues across sessions through `Bot_Job_Log.md` (Korean).

- At the start of a session, read its top section "다음 작업 시작하기" and the "남은 작업" list at the bottom before changing anything.
- After each task, add a numbered entry under today's date, and update the top section (현재 상태, 알려진 문제) and "남은 작업" so the next session can pick up from there.
- Talk to the user in Korean. Commit and push to `origin` (github.com/moonlightpark/JajangBot, `main`) only when the user asks.

## Testing

Tests live in `test/`, not next to `src/`.

```sh
bun test
```

## The core message (do not break this)

The demo is a live Jev trading bot on Bybit (USDT linear perps). Every design or strategy change must keep these claims true:

> I built a trading bot with Jev!
>
> Jev decides if it should "buy" or "sell", given the price feed of an asset pair, and executes real trades.
>
> Jev decides on every Bybit tick.
>
> Demo link: https://www.jev-trade.com/

Non-negotiables: Jev makes the buy/sell call (not code), from the price feed; real trades from a real Bybit sub-account; a Jev decision every tick, not every N ticks. The demo is the live dashboard. No middle dots, em dashes or en dashes in any rendered text. No blinking or pulsing indicators.

Bybit is the only venue (`src/bybit-*.ts`). Hyperliquid support was removed on 2026-10-04. The Trader talks to the exchange through the `VenueMarket` interface in `src/venue.ts`. `BYBIT_ENV` defaults to `demo`; only `mainnet` moves real funds, and the dashboard header must say so (Live / Testnet / Demo / Dry run from `web/src/lib/mode.ts`).

`MODEL` picks who decides: `jev` (the demo's claim), `mock` (stand-in), or `strategy` (the user's TradingView channel rules in `src/strategy.ts`). Only `MODEL=jev` satisfies the core message. With `mock` or `strategy`, code makes the call, so the dashboard header must say who decides (`deciderLabel` in `web/src/lib/mode.ts`). Never let the page imply Jev decided when it did not.

Hold is one of Jev's answers, so a tick can end with no order. That is Jev's call, not the code skipping a tick, and the decision still happens every tick. Do not reintroduce a forced buy or sell just to keep an order on the book.
