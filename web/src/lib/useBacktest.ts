"use client";

import { useEffect, useState } from "react";
import { parseBacktest } from "./backtest";
import type { BacktestReport } from "./bot-types";

/** The last `bun run backtest` result from the bot, or null when there is none. Loaded once per bot start. */
export function useBacktest(apiUrl: string, startedAt: number | undefined): BacktestReport | null {
  const [report, setReport] = useState<BacktestReport | null>(null);

  useEffect(() => {
    if (startedAt == null) return;
    const base = (apiUrl || "").replace(/\/+$/, "");
    let live = true;
    fetch(`${base}/backtest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (live) setReport(parseBacktest(raw));
      })
      .catch(() => {
        if (live) setReport(null);
      });
    return () => {
      live = false;
    };
  }, [apiUrl, startedAt]);

  return report;
}
