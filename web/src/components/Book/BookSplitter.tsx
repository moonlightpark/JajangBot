"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./Book.module.css";

const KEY = "jevtrade.bookHeight";
const MIN = 120;
/** The chart keeps at least this much when the panel grows. */
const CHART_MIN = 200;
const STEP = 24;

function stored(): number | null {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function store(h: number) {
  try {
    localStorage.setItem(KEY, String(Math.round(h)));
  } catch {
    // private window: the height lasts for this visit only
  }
}

/**
 * Height of the 포지션 / 체결 / 거래기록 panel, set by dragging the bar above it.
 * `max` comes from the shell, so the chart keeps CHART_MIN. Null until the viewer drags.
 */
export function useBookHeight(shell: React.RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState<number | null>(null);

  const clamp = useCallback(
    (h: number) => {
      const el = shell.current;
      const panel = el?.querySelector<HTMLElement>("[data-book]");
      // Everything but the chart row and the panel: header, gaps, the bar itself.
      const main = el?.querySelector<HTMLElement>("[data-main]");
      const fixed = el && main && panel ? el.clientHeight - main.offsetHeight - panel.offsetHeight : 0;
      const max = el ? Math.max(MIN, el.clientHeight - fixed - CHART_MIN) : Infinity;
      return Math.round(Math.min(max, Math.max(MIN, h)));
    },
    [shell],
  );

  // The saved height, fitted to this window.
  useEffect(() => {
    const h = stored();
    if (h != null) setHeight(clamp(h));
  }, [clamp]);

  const set = useCallback((h: number) => {
    const next = clamp(h);
    setHeight(next);
    store(next);
  }, [clamp]);

  return { height, set, current: () => shell.current?.querySelector<HTMLElement>("[data-book]")?.offsetHeight ?? 220 };
}

/** The bar between the chart and the panel. Drag it, or focus it and use the arrow keys. */
export default function BookSplitter({ onResize, current }: { onResize: (h: number) => void; current: () => number }) {
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [active, setActive] = useState(false);

  return (
    <div
      className={styles.splitter}
      data-active={active ? "true" : "false"}
      role="separator"
      aria-orientation="horizontal"
      aria-label="차트와 하단 영역 크기 조절"
      title="드래그해서 크기 조절, 더블클릭하면 기본 크기"
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, h: current() };
        setActive(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        // Up grows the panel.
        onResize(drag.current.h + (drag.current.y - e.clientY));
      }}
      onPointerUp={() => {
        drag.current = null;
        setActive(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
      }}
      onDoubleClick={() => onResize(220)}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") onResize(current() + STEP);
        else if (e.key === "ArrowDown") onResize(current() - STEP);
        else return;
        e.preventDefault();
      }}
    >
      <span className={styles.splitterGrip} aria-hidden="true" />
    </div>
  );
}
