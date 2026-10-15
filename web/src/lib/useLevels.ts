"use client";

import { useEffect, useState } from "react";
import type { ChannelPoint } from "./bot-types";
import { parseLevels } from "./levels";

/** A new 15m bar closes every 15 minutes; the forming one comes live from each tick. */
const REFRESH_MS = 5 * 60_000;

/** MODEL=strategy channel history per coin from the bot. Empty for mock and jev. */
export function useLevels(apiUrl: string, startedAt: number | undefined): Record<string, ChannelPoint[]> {
  const [levels, setLevels] = useState<Record<string, ChannelPoint[]>>({});

  useEffect(() => {
    if (startedAt == null) return;
    const base = (apiUrl || "").replace(/\/+$/, "");
    let live = true;
    const load = () =>
      fetch(`${base}/levels`)
        .then((r) => (r.ok ? r.json() : null))
        .then((raw) => {
          if (live && raw) setLevels(parseLevels(raw));
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [apiUrl, startedAt]);

  return levels;
}
