/** Chart clock. Bars stay on UTC buckets; only the labels move to the chosen offset. */

export type ChartZone = { id: string; label: string; offsetH: number };

export const ZONES: ChartZone[] = [
  { id: "kst", label: "한국시간", offsetH: 9 },
  { id: "utc", label: "UTC", offsetH: 0 },
];

export const DEFAULT_ZONE = ZONES[0]!;

const pad = (n: number) => String(n).padStart(2, "0");

function shifted(sec: number, offsetH: number): Date {
  return new Date((sec + offsetH * 3600) * 1000);
}

/** Axis label for lightweight-charts TickMarkType: 0 Year, 1 Month, 2 DayOfMonth, 3 Time, 4 TimeWithSeconds. */
export function tickLabel(sec: number, type: number, offsetH: number): string {
  const d = shifted(sec, offsetH);
  switch (type) {
    case 0:
      return String(d.getUTCFullYear());
    case 1:
      return `${d.getUTCMonth() + 1}월`;
    case 2:
      return `${d.getUTCDate()}일`;
    case 4:
      return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    default:
      return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
}

/** Crosshair label: "2026-10-14 20:00", with seconds on the 1s view. */
export function crosshairLabel(sec: number, offsetH: number, withSeconds = false): string {
  const d = shifted(sec, offsetH);
  const day = `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
  const clock = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${day} ${clock}${withSeconds ? `:${pad(d.getUTCSeconds())}` : ""}`;
}

/** "10.05 07:30" from ms epoch in the chart zone, like fmtDateTime but not tied to the browser. */
export function zonedDateTime(ms: number | null | undefined, offsetH: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "--.-- --:--";
  const d = shifted(ms / 1000, offsetH);
  return `${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
