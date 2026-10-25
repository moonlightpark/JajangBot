"use client";

import { useEffect, useState } from "react";
import type { DailyReport } from "./bot-types";

/** A report lands once a day; a few minutes late is fine. */
const REFRESH_MS = 5 * 60_000;

function isReport(r: unknown): r is DailyReport {
  const o = r as Partial<DailyReport> | null;
  return !!o && typeof o.date === "string" && typeof o.coin === "string" && typeof o.startBalance === "number" && typeof o.endBalance === "number";
}

/** The bot's daily reports (GET /reports), newest first. Empty until the first one. */
export function useReports(apiUrl: string, startedAt: number | undefined): DailyReport[] {
  const [reports, setReports] = useState<DailyReport[]>([]);

  useEffect(() => {
    if (startedAt == null) return;
    const base = (apiUrl || "").replace(/\/+$/, "");
    let live = true;
    const load = () =>
      fetch(`${base}/reports`)
        .then((r) => (r.ok ? r.json() : null))
        .then((raw) => {
          if (live && Array.isArray(raw)) setReports(raw.filter(isReport));
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [apiUrl, startedAt]);

  return reports;
}
