"use client";

import { useCallback, useMemo, useState } from "react";
import Book from "@/components/Book/Book";
import DecisionPanel from "@/components/DecisionPanel/DecisionPanel";
import Feed from "@/components/Feed/Feed";
import FlowChart from "@/components/FlowChart/FlowChart";
import Header from "@/components/Header/Header";
import { deciderLabel, tradingMode } from "@/lib/mode";
import { portfolioBalance, portfolioPnl } from "@/lib/pnl";
import { backtestOpenPnl } from "@/lib/backtest";
import { useBacktest } from "@/lib/useBacktest";
import { useFeed } from "@/lib/useFeed";
import { useLevels } from "@/lib/useLevels";
import type { ChartFocus } from "@/lib/ohlc";
import type { BlockEvent, Meta, SleeveFeed } from "@/lib/types";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const EMPTY: SleeveFeed = { events: [], tape: [], latest: null, avgLatencyMs: 0 };

function viewMeta(meta: Meta | null, coin: string): Meta | null {
  if (!meta) return null;
  const sleeve = meta.sleeves.find((s) => s.coin === coin);
  return {
    ...meta,
    coin,
    pair: sleeve?.pair ?? meta.pair,
    market: sleeve?.pair ?? meta.market,
    wallet: sleeve?.wallet ?? meta.wallet,
  };
}

export default function Page() {
  const feed = useFeed(API_URL);
  const backtest = useBacktest(API_URL, feed.meta?.startedAt);
  const channelByCoin = useLevels(API_URL, feed.meta?.startedAt);
  const [picked, setPicked] = useState<string | null>(null);
  const [focus, setFocus] = useState<ChartFocus | null>(null);
  const focusTrade = useCallback((c: string, fromMs: number, toMs: number) => {
    setPicked(c);
    setFocus({ coin: c, fromMs, toMs, nonce: Date.now() });
  }, []);

  const coins = useMemo(() => {
    if (feed.meta?.sleeves.length) return feed.meta.sleeves.map((s) => s.coin);
    return Object.keys(feed.byCoin);
  }, [feed.meta, feed.byCoin]);

  // BTC by default. Another coin is picked from the position or history rows.
  const coin = picked && coins.includes(picked) ? picked : coins.includes("BTC") ? "BTC" : coins[0] ?? "BTC";
  const sleeve = feed.byCoin[coin] ?? EMPTY;
  const meta = viewMeta(feed.meta, coin);

  const latestByCoin = useMemo(() => {
    const out: Record<string, BlockEvent | null> = {};
    for (const c of coins) out[c] = feed.byCoin[c]?.latest ?? null;
    return out;
  }, [coins, feed.byCoin]);

  const tapeByCoin = useMemo(() => {
    const out: Record<string, NonNullable<SleeveFeed["tape"]>> = {};
    for (const c of coins) out[c] = feed.byCoin[c]?.tape ?? [];
    return out;
  }, [coins, feed.byCoin]);

  const pnl = useMemo(() => portfolioPnl(latestByCoin), [latestByCoin]);
  const balance = useMemo(() => portfolioBalance(latestByCoin), [latestByCoin]);
  const hasBooks = coins.some((c) => latestByCoin[c]);
  // Dry run balances start from the backtest's closed PnL; show how much so balance adds up.
  const backtestUsd = useMemo(() => {
    const rows = feed.meta?.sleeves ?? [];
    return rows.some((s) => s.backtestUsd) ? rows.reduce((sum, s) => sum + (s.backtestUsd ?? 0), 0) : null;
  }, [feed.meta]);
  const backtestOpen = useMemo(() => {
    const mids: Record<string, number | null | undefined> = {};
    for (const c of coins) mids[c] = latestByCoin[c]?.mid;
    // A position the dry run carried on is the bot's now: its PnL is in the balance already.
    const carried = new Set((feed.meta?.sleeves ?? []).filter((s) => s.carried).map((s) => s.coin));
    return backtestOpenPnl(backtest, mids, carried);
  }, [backtest, coins, latestByCoin, feed.meta]);
  const waiting = !feed.meta;

  return (
    <div className="shell">
      <Header
        connection={feed.connection}
        balance={hasBooks ? balance : null}
        unrealized={hasBooks ? pnl.unrealized : null}
        realized={hasBooks ? pnl.realized : null}
        backtest={hasBooks ? backtestUsd : null}
        backtestOpen={hasBooks ? backtestOpen : null}
        mode={meta ? tradingMode(meta, meta.wallet) : null}
        decider={meta ? deciderLabel(meta.model) : null}
        apiUrl={API_URL}
        meta={feed.meta}
      />
      <div className={styles.main}>
        <div className={styles.left}>
          <div className={styles.chartWrap}>
            <FlowChart
              tape={sleeve.tape ?? []}
              events={sleeve.events}
              latest={sleeve.latest}
              meta={meta}
              backtest={backtest}
              channelPoints={channelByCoin[coin]}
              focus={focus?.coin === coin ? focus : null}
              onNeedMoreTape={feed.loadTape}
            />
          </div>
        </div>
        <div className={styles.right}>
          <DecisionPanel latest={sleeve.latest} meta={meta} waiting={waiting} />
          <Feed events={sleeve.events} meta={meta} waiting={waiting} />
        </div>
      </div>
      <Book
        sleeves={feed.meta?.sleeves ?? []}
        latestByCoin={latestByCoin}
        tapeByCoin={tapeByCoin}
        selected={coin}
        meta={meta}
        onSelect={setPicked}
        onFocusTrade={focusTrade}
        onNeedMoreTape={feed.loadTape}
        backtest={backtest}
        waiting={waiting}
      />
    </div>
  );
}
