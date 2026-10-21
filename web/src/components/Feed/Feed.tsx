"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BlockEvent, Meta } from "@/lib/types";
import { fmtClock, fmtPrice, HOLD_KO, LATE_KO, shortTx, SIDE_KO, txUrl } from "@/lib/format";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./Feed.module.css";

const ROW_H = 26;
const MAX_ROWS = 40;

type Kind = "buy" | "sell" | "hold" | "late";

function kindOf(event: BlockEvent): Kind {
  const d = event.decision;
  if (!d || d.late) return "late";
  if (d.intent === "hold" || d.action === "hold") return "hold";
  if (d.bias === "short" || d.action === "sell") return "sell";
  if (d.bias === "long" || d.action === "buy") return "buy";
  return "late";
}

function fmtSize(size: number): string {
  if (size > 0 && size < 0.01) {
    return size.toLocaleString("en-US", { maximumFractionDigits: 5, minimumFractionDigits: 3 });
  }
  return size.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const KIND_CLASS: Record<Kind, string> = {
  buy: styles.kindBuy,
  sell: styles.kindSell,
  hold: styles.kindHold,
  late: styles.kindLate,
};

function wordOf(event: BlockEvent, kind: Kind): string {
  const d = event.decision;
  if (kind === "late") return LATE_KO;
  if (kind === "hold") return HOLD_KO;
  if (d?.intent === "close") return d.closeFraction ? "부분 익절" : "청산";
  if (d?.intent === "open") return "진입";
  if (d?.action === "buy") return SIDE_KO.buy!;
  if (d?.action === "sell") return SIDE_KO.sell!;
  return LATE_KO;
}

function isCallRow(event: BlockEvent): boolean {
  return Boolean(event.decision && !event.decision.late);
}

export default function Feed({
  events,
  meta,
  waiting = false,
}: {
  events: BlockEvent[];
  meta?: Meta | null;
  waiting?: boolean;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [capacity, setCapacity] = useState(MAX_ROWS);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const measure = () => {
      const fits = Math.max(1, Math.min(MAX_ROWS, Math.floor(el.clientHeight / ROW_H)));
      setCapacity((prev) => (prev === fits ? prev : fits));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const callRows = useMemo(() => events.filter(isCallRow), [events]);

  return (
    <section className={styles.feed}>
      <div className={styles.railHead}>판단 기록</div>
      <div className={styles.list} ref={listRef}>
        {waiting && callRows.length === 0 ? (
          <div aria-busy="true" aria-label="판단 기록 불러오는 중">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={styles.row}>
                <span className={`${styles.cell} ${styles.time}`}>
                  <Bone w={56} h={8} />
                </span>
                <span className={`${styles.cell} ${styles.word}`}>
                  <Bone w={40} h={8} />
                </span>
                <span className={`${styles.cell} ${styles.lat}`}>
                  <Bone w={28} h={8} />
                </span>
                <span className={`${styles.cell} ${styles.detail}`}>
                  <Bone w={i % 2 ? 88 : 120} h={8} />
                </span>
              </div>
            ))}
          </div>
        ) : callRows.length === 0 ? (
          <div className={styles.empty}>아직 판단이 없습니다</div>
        ) : (
          callRows.slice(-capacity).reverse().map((event, i) => {
            const kind = kindOf(event);
            const decision = event.decision;
            const quote = event.quote;
            const fill = event.fill;
            const decided = kind !== "late";
            const kindClass = KIND_CLASS[kind];

            const lat = !decided || !decision ? "" : `${decision.latencyMs}ms`;

            let detail = "";
            let detailMuted = false;
            if (fill && fill.size > 0) {
              detail = `${fmtSize(fill.size)} @ ${fmtPrice(fill.price)}`;
            } else if (decided && quote) {
              const word = quote.taker ? "시장가" : quote.side === "buy" ? "매수호가" : "매도호가";
              const lev = quote.taker || decision?.leverage == null ? "" : ` ${decision.leverage}x`;
              const bias = quote.taker || !decision?.bias ? "" : ` ${SIDE_KO[decision.bias] ?? decision.bias}`;
              detail = `${word} ${fmtSize(quote.size)} @ ${fmtPrice(quote.price)}${bias}${lev}${quote.reduceOnly ? " 감소전용" : ""}`;
              detailMuted = quote.status === "reverted";
            } else if (decided && kind === "hold") {
              detail = event.position.side === "flat" ? "주문 없음" : "포지션 유지";
              detailMuted = true;
            } else if (decided && decision?.intent === "close" && event.position.side === "flat") {
              detail = "이미 포지션 없음";
              detailMuted = true;
            }

            const rowClass = [styles.row, kindClass, i === 0 ? styles.newest : "", fill ? styles.filled : ""]
              .filter(Boolean)
              .join(" ");

            return (
              <div key={event.block} className={rowClass}>
                <span className={`${styles.cell} ${styles.time}`}>{fmtClock(event.ts, true)}</span>
                <span className={`${styles.cell} ${styles.word}`}>{wordOf(event, kind)}</span>
                <span className={`${styles.cell} ${styles.lat}`}>{lat}</span>
                <span
                  className={`${styles.cell} ${styles.detail}${detailMuted ? ` ${styles.muted}` : ""}`}
                >
                  {detail}
                </span>
                <span className={`${styles.cell} ${styles.tx}`}>
                  {fill && !fill.simulated && fill.txHash ? (
                    <a href={txUrl(fill.txHash, meta?.explorerTx)} target="_blank" rel="noreferrer" title="테이커 거래">
                      {shortTx(fill.txHash)}
                    </a>
                  ) : quote && quote.status === "sim" ? (
                    <span className={styles.muted}>가상</span>
                  ) : quote && quote.txHash ? (
                    <a
                      className={quote.status === "placed" ? undefined : styles.muted}
                      title={quote.status}
                      href={txUrl(quote.txHash, meta?.explorerTx)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {quote.status === "reverted" ? "실패" : shortTx(quote.txHash)}
                    </a>
                  ) : null}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
