"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type TickMarkType,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { backtestDetail, type BacktestMark } from "@/lib/backtest";
import { asUtcSec, canUpdateInPlace, focusRange, type Candle, type ChartFocus, type FillMark, type SeriesShown } from "@/lib/ohlc";
import type { ChannelLines } from "@/lib/levels";
import { crosshairLabel, tickLabel, zonedDateTime } from "@/lib/chartTime";
import styles from "./FlowChart.module.css";

export type EntryLine = {
  price: number;
  side: "long" | "short";
};

type Props = {
  candles: Candle[];
  marks: FillMark[];
  /** Simulated trades from `bun run backtest`. Drawn in their own color so they never pass for fills. */
  backtest: BacktestMark[];
  /** Coin and backtest leverage for the hover card. */
  coin: string;
  backtestLeverage: number;
  entry: EntryLine | null;
  /** MODEL=strategy channel over time: dashed long (red) and short (blue) lines. */
  channel: ChannelLines | null;
  rangeKey: string;
  /** Scroll to this trade once its bars are loaded. */
  focus: ChartFocus | null;
  /** Bars around a focused trade at least. */
  visibleBars: number;
  /** Bars shown when the chart opens or the interval changes. */
  startBars: number;
  secondsVisible: boolean;
  /** Hours added to UTC for axis, crosshair, and hover card labels. */
  offsetH: number;
  formatPrice: (n: number) => string;
};

// Korean convention: rising, buy, and long are red; falling, sell, and short are blue.
const UP = "#c84a31";
const DOWN = "#1261c4";
const BUY = "#c84a31";
const SELL = "#1261c4";
// Backtest marks stay purple so they never pass for real fills.
const BACKTEST = "#7b3fd1";
const BT_WIN = "#e0533f";
const BT_LOSS = "#3d7ee0";

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

/** Long entry and short exit buy, so they sit below the bar; the other two sit above. */
function toBacktestMarkers(rows: BacktestMark[]): SeriesMarker<Time>[] {
  return rows.map((m) => {
    const below = (m.kind === "entry") === (m.side === "long");
    return {
      time: asTime(m.time),
      position: below ? "belowBar" : "aboveBar",
      shape: m.kind === "exit" ? "circle" : below ? "arrowUp" : "arrowDown",
      color: m.kind === "exit" ? (m.win ? BT_WIN : BT_LOSS) : BACKTEST,
      size: m.kind === "exit" ? 0.6 : 0.9,
      text: m.text,
    };
  });
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
  backtest,
  coin,
  backtestLeverage,
  entry,
  channel,
  rangeKey,
  focus,
  visibleBars,
  startBars,
  secondsVisible,
  offsetH,
  formatPrice,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const entryLineRef = useRef<IPriceLine | null>(null);
  const longRef = useRef<ISeriesApi<"Line"> | null>(null);
  const shortRef = useRef<ISeriesApi<"Line"> | null>(null);
  const stemRef = useRef("");
  /** What the series holds now, so an incremental update is only used when it is safe. */
  const shownRef = useRef<SeriesShown>({ key: "", stem: "", count: 0, lastTime: 0 });
  const rangeRef = useRef("");
  /** The focus last applied, and the bars it was applied on. */
  const focusedRef = useRef({ nonce: 0, rangeKey: "", stem: "" });
  const btByTimeRef = useRef(new Map<number, BacktestMark[]>());
  const [hover, setHover] = useState<{ x: number; y: number; time: number } | null>(null);
  const formatRef = useRef(formatPrice);
  formatRef.current = formatPrice;
  const clockRef = useRef({ offsetH, secondsVisible });
  clockRef.current = { offsetH, secondsVisible };

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const chart = createChart(el, {
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#8a8f98",
        fontFamily: "Pretendard Variable, Pretendard, -apple-system, Apple SD Gothic Neo, Malgun Gothic, sans-serif",
      },
      grid: {
        vertLines: { color: "#f1f2f5" },
        horzLines: { color: "#f1f2f5" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#dfe2e8", scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: "#dfe2e8",
        timeVisible: true,
        secondsVisible,
        shiftVisibleRangeOnNewBar: true,
        // 45 days of 15m bars is about 4300 candles; the default 0.5px floor would cut that short.
        minBarSpacing: 0.1,
        tickMarkFormatter: (time: Time, type: TickMarkType) => tickLabel(time as number, type, clockRef.current.offsetH),
      },
      localization: {
        priceFormatter: (p: number) => formatRef.current(p),
        timeFormatter: (time: Time) => crosshairLabel(time as number, clockRef.current.offsetH, clockRef.current.secondsVisible),
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    // Line series join the autoscale, so the channel stays on screen like the candles.
    const line = (color: string, title: string) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title,
      });
    longRef.current = line(BUY, "롱");
    shortRef.current = line(SELL, "숏");
    const markers = createSeriesMarkers(series, []);
    // Hover card for backtest trades: shows when the crosshair sits on a bar that has a BT mark.
    chart.subscribeCrosshairMove((param) => {
      const t = typeof param.time === "number" ? param.time : null;
      if (t == null || !param.point || !btByTimeRef.current.has(t)) {
        setHover((h) => (h ? null : h));
        return;
      }
      const { x, y } = param.point;
      setHover((h) => (h && h.time === t && Math.abs(h.x - x) < 24 && Math.abs(h.y - y) < 24 ? h : { x, y, time: t }));
    });
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
      longRef.current = null;
      shortRef.current = null;
      stemRef.current = "";
      shownRef.current = { key: "", stem: "", count: 0, lastTime: 0 };
      rangeRef.current = "";
      focusedRef.current = { nonce: 0, rangeKey: "", stem: "" };
    };
  }, []);

  // Formatters read clockRef; applyOptions makes the chart redraw its labels.
  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { secondsVisible, timeVisible: true } });
  }, [secondsVisible, offsetH]);

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
      showLatest(chartRef.current, bars.length, startBars);
    }
  }, [candles, rangeKey, startBars]);

  // After the bars effect, so a focus wins over its jump to the latest bar. Waits until the
  // loaded bars reach back to the trade, and applies again when older bars load into the same
  // view (that redraw jumps to the latest bar).
  useEffect(() => {
    if (!focus) return;
    const done = focusedRef.current;
    const stem = stemRef.current;
    if (done.nonce === focus.nonce && (done.rangeKey !== rangeKey || done.stem === stem)) return;
    const range = focusRange(candles.map((b) => b.time), asUtcSec(focus.fromMs), asUtcSec(focus.toMs), visibleBars);
    if (!range) return;
    chartRef.current?.timeScale().setVisibleLogicalRange(range);
    focusedRef.current = { nonce: focus.nonce, rangeKey, stem };
  }, [focus, candles, rangeKey, visibleBars]);

  useEffect(() => {
    const byTime = new Map<number, BacktestMark[]>();
    for (const m of backtest) byTime.set(m.time, [...(byTime.get(m.time) ?? []), m]);
    // The marks are rebuilt on every price print, so keep the hover; a stale time just finds no marks.
    btByTimeRef.current = byTime;
    const all = toMarkers(marks).concat(toBacktestMarkers(backtest));
    all.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current?.setMarkers(all);
  }, [marks, backtest]);

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
      title: "진입가",
    };
    if (entryLineRef.current) {
      entryLineRef.current.applyOptions(next);
      return;
    }
    entryLineRef.current = series.createPriceLine(next);
  }, [entry]);

  useEffect(() => {
    const toLine = (rows: { time: number; value: number }[]) => rows.map((r) => ({ time: asTime(r.time), value: r.value }));
    longRef.current?.setData(channel ? toLine(channel.long) : []);
    shortRef.current?.setData(channel ? toLine(channel.short) : []);
  }, [channel]);

  const hovered = hover ? btByTimeRef.current.get(hover.time) ?? [] : [];
  const hostW = hostRef.current?.clientWidth ?? 0;
  const flip = hover != null && hover.x > hostW - 300;

  return (
    <>
      <div ref={hostRef} className="lwc-host" style={{ position: "absolute", inset: 0 }} />
      {hover && hovered.length ? (
        <div
          className={styles.btCard}
          style={{ left: flip ? undefined : hover.x + 16, right: flip ? hostW - hover.x + 16 : undefined, top: Math.max(8, hover.y - 40) }}
          role="tooltip"
        >
          {hovered.map((m) => {
            const d = backtestDetail(m.trade, coin, backtestLeverage, (ms) => zonedDateTime(ms, offsetH));
            return (
              <div key={`${m.kind}|${m.trade.entryTs}|${m.text}`} className={styles.btTrade}>
                <div className={styles.btHead}>
                  <span className={d.side === "long" ? styles.btLong : styles.btShort}>{d.title}</span>
                  <span className={styles.btKind}>{m.kind === "entry" ? "진입" : "청산"}</span>
                </div>
                {d.rows.map((r) => (
                  <div key={r.label} className={styles.btRow}>
                    <span className={styles.btLabel}>{r.label}</span>
                    <span className={r.tone ? styles[`bt_${r.tone}`] : undefined}>{r.value}</span>
                  </div>
                ))}
              </div>
            );
          })}
          <div className={styles.btNote}>전략 백테스트의 가상 거래이며 실제 체결이 아닙니다</div>
        </div>
      ) : null}
    </>
  );
}
