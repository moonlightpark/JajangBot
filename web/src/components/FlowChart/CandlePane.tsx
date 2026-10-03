"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { canUpdateInPlace, type Candle, type FillMark, type SeriesShown } from "@/lib/ohlc";
import type { StrategyLevels } from "@/lib/types";

export type EntryLine = {
  price: number;
  side: "long" | "short";
};

type Props = {
  candles: Candle[];
  marks: FillMark[];
  entry: EntryLine | null;
  /** MODEL=strategy channel: dashed long (green) and short (red) lines. */
  levels: StrategyLevels | null;
  /** Stretch the price scale so the lines stay on screen. Off for 1s bars, where they would flatten the candles. */
  fitLevels: boolean;
  rangeKey: string;
  visibleBars: number;
  secondsVisible: boolean;
  formatPrice: (n: number) => string;
};

const UP = "#000000";
const DOWN = "#ffffff";
const BUY = "#00aa00";
const SELL = "#cc0000";

function asTime(sec: number): UTCTimestamp {
  return sec as UTCTimestamp;
}

function toBars(rows: Candle[]): CandlestickData<Time>[] {
  return rows.map((c) => ({
    time: asTime(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

function toMarkers(rows: FillMark[]): SeriesMarker<Time>[] {
  return rows.map((m) => ({
    time: asTime(m.time),
    position: m.side === "buy" ? "belowBar" : "aboveBar",
    shape: m.side === "buy" ? "arrowUp" : "arrowDown",
    color: m.side === "buy" ? BUY : SELL,
    size: 0.8,
  }));
}

function stemOf(rows: Candle[]): string {
  if (!rows.length) return "empty";
  return `${rows[0]!.time}`;
}

function showLatest(chart: IChartApi | null, count: number, visibleBars: number) {
  if (!chart || count <= 0) return;
  const to = count + 1;
  const from = Math.max(-1, to - visibleBars);
  chart.timeScale().setVisibleLogicalRange({ from, to });
}

export default function CandlePane({
  candles,
  marks,
  entry,
  levels,
  fitLevels,
  rangeKey,
  visibleBars,
  secondsVisible,
  formatPrice,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const entryLineRef = useRef<IPriceLine | null>(null);
  const longLineRef = useRef<IPriceLine | null>(null);
  const shortLineRef = useRef<IPriceLine | null>(null);
  const levelsRef = useRef<{ levels: StrategyLevels | null; fit: boolean }>({ levels: null, fit: false });
  levelsRef.current = { levels, fit: fitLevels };
  const stemRef = useRef("");
  /** What the series holds now, so an incremental update is only used when it is safe. */
  const shownRef = useRef<SeriesShown>({ key: "", stem: "", count: 0, lastTime: 0 });
  const rangeRef = useRef("");
  const formatRef = useRef(formatPrice);
  formatRef.current = formatPrice;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const chart = createChart(el, {
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#666666",
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: "#e5e5e5" },
        horzLines: { color: "#e5e5e5" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#000000", scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: "#000000",
        timeVisible: true,
        secondsVisible,
        shiftVisibleRangeOnNewBar: true,
      },
      localization: { priceFormatter: (p: number) => formatRef.current(p) },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: UP,
      wickUpColor: UP,
      wickDownColor: UP,
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const r = original();
        const { levels: lv, fit } = levelsRef.current;
        if (!r || !r.priceRange || !lv || !fit) return r;
        return {
          ...r,
          priceRange: {
            minValue: Math.min(r.priceRange.minValue, lv.long),
            maxValue: Math.max(r.priceRange.maxValue, lv.short),
          },
        };
      },
    });
    const markers = createSeriesMarkers(series, []);
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      chart.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
    });
    ro.observe(el);
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markers;
    return () => {
      ro.disconnect();
      markers.detach();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      entryLineRef.current = null;
      longLineRef.current = null;
      shortLineRef.current = null;
      stemRef.current = "";
      shownRef.current = { key: "", stem: "", count: 0, lastTime: 0 };
      rangeRef.current = "";
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { secondsVisible, timeVisible: true } });
  }, [secondsVisible]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const bars = toBars(candles);
    const stem = stemOf(candles);
    if (!bars.length) {
      series.setData([]);
      stemRef.current = stem;
      shownRef.current = { key: rangeKey, stem, count: 0, lastTime: 0 };
      return;
    }
    const stemChanged = stemRef.current !== stem;
    const last = bars[bars.length - 1]!;
    const next: SeriesShown = { key: rangeKey, stem, count: bars.length, lastTime: last.time as number };
    // update() only appends or rewrites the newest bar; anything else is a full redraw.
    if (canUpdateInPlace(shownRef.current, next)) {
      series.update(last);
    } else {
      series.setData(bars);
      stemRef.current = stem;
    }
    shownRef.current = next;
    if (rangeRef.current !== rangeKey || stemChanged) {
      rangeRef.current = rangeKey;
      showLatest(chartRef.current, bars.length, visibleBars);
    }
  }, [candles, rangeKey, visibleBars]);

  useEffect(() => {
    markersRef.current?.setMarkers(toMarkers(marks));
  }, [marks]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (!entry || !(entry.price > 0)) {
      if (entryLineRef.current) {
        series.removePriceLine(entryLineRef.current);
        entryLineRef.current = null;
      }
      return;
    }
    const next = {
      price: entry.price,
      color: entry.side === "long" ? BUY : SELL,
      lineWidth: 1 as const,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: "entry",
    };
    if (entryLineRef.current) {
      entryLineRef.current.applyOptions(next);
      return;
    }
    entryLineRef.current = series.createPriceLine(next);
  }, [entry]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const draw = (ref: { current: IPriceLine | null }, price: number | undefined, color: string, title: string) => {
      if (!(price && price > 0)) {
        if (ref.current) series.removePriceLine(ref.current);
        ref.current = null;
        return;
      }
      const opts = { price, color, lineWidth: 1 as const, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title };
      if (ref.current) ref.current.applyOptions(opts);
      else ref.current = series.createPriceLine(opts);
    };
    draw(shortLineRef, levels?.short, SELL, "short");
    draw(longLineRef, levels?.long, BUY, "long");
    // Re-run autoscale so a new band or a 1s switch takes effect now, not on the next bar.
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
  }, [levels, fitLevels]);

  return <div ref={hostRef} className="lwc-host" style={{ position: "absolute", inset: 0 }} />;
}
