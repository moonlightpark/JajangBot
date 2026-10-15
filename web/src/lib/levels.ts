import type { ChannelPoint, StrategyLevels } from "./bot-types";
import { barMs, M15_MS, type BarSize } from "./ohlc";

export type LinePoint = { time: number; value: number };
export type ChannelLines = { long: LinePoint[]; short: LinePoint[] };

/**
 * The 15m strategy channel on the view's bars. Each bar gets the channel of the 15m bar
 * it closes in (a 1D bar shows the day's last 15m value; a 1m bar the 15m bar it sits in).
 * `live` is the channel this tick, on the newest bar. `times` are bar starts in seconds, oldest first.
 */
export function channelForView(
  points: ChannelPoint[],
  times: number[],
  bar: BarSize,
  live: StrategyLevels | null,
): ChannelLines | null {
  if (!times.length || (!points.length && !live)) return null;
  const span = barMs(bar);
  const long: LinePoint[] = [];
  const short: LinePoint[] = [];
  let j = -1;
  for (const time of times) {
    // Start of the last 15m bar inside this view bar.
    const target = time * 1000 + Math.max(span, M15_MS) - M15_MS;
    while (j + 1 < points.length && points[j + 1]!.ts <= target) j++;
    if (j < 0) continue;
    long.push({ time, value: points[j]!.long });
    short.push({ time, value: points[j]!.short });
  }
  const last = times[times.length - 1]!;
  if (live && live.long > 0 && live.short > 0) {
    if (long.at(-1)?.time === last) {
      long.pop();
      short.pop();
    }
    long.push({ time: last, value: live.long });
    short.push({ time: last, value: live.short });
  }
  return long.length ? { long, short } : null;
}

export function parseLevels(raw: unknown): Record<string, ChannelPoint[]> {
  const out: Record<string, ChannelPoint[]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [coin, rows] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    out[coin] = rows
      .map((r) => ({ ts: Number(r?.ts), long: Number(r?.long), short: Number(r?.short) }))
      .filter((r) => r.ts > 0 && r.long > 0 && r.short > 0)
      .sort((a, b) => a.ts - b.ts);
  }
  return out;
}
