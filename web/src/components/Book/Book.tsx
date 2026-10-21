"use client";

import { useMemo, useState } from "react";
import type { BlockEvent, Meta, PricePoint, SleeveMeta } from "@/lib/types";
import type { BacktestReport } from "@/lib/bot-types";
import { backtestLots, lotSummary } from "@/lib/backtest";
import { closedLots, tapeFills } from "@/lib/fills";
import { roePct } from "@/lib/pnl";
import { displayCoin, fmtClock, fmtCoin, fmtDateTime, fmtPct, fmtPrice, fmtSignedUsd, fmtUsd, shortTx, SIDE_KO, txUrl } from "@/lib/format";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./Book.module.css";

type Tab = "positions" | "trades" | "history";

const TRADE_CAP = 200;
/** Three months of backtest trades on every coin fit, with room for the bot's own. */
const HISTORY_CAP = 2000;

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10).replaceAll("-", ".");

function fmtSize(size: number): string {
  if (size > 0 && size < 0.01) {
    return size.toLocaleString("en-US", { maximumFractionDigits: 5, minimumFractionDigits: 3 });
  }
  return size.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export default function Book({
  sleeves,
  latestByCoin,
  tapeByCoin,
  selected,
  meta,
  onSelect,
  onNeedMoreTape,
  backtest = null,
  waiting = false,
}: {
  sleeves: SleeveMeta[];
  latestByCoin: Record<string, BlockEvent | null>;
  tapeByCoin: Record<string, PricePoint[]>;
  selected: string;
  meta?: Meta | null;
  onSelect: (coin: string) => void;
  onNeedMoreTape?: () => void;
  /** Last `bun run backtest` run. Its closed trades are listed in History, marked as backtest. */
  backtest?: BacktestReport | null;
  waiting?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("positions");
  const [allMarkets, setAllMarkets] = useState(false);
  const [showBacktest, setShowBacktest] = useState(true);

  const trades = useMemo(() => {
    const rows = [];
    for (const sleeve of sleeves) {
      if (!allMarkets && sleeve.coin !== selected) continue;
      for (const fill of tapeFills(tapeByCoin[sleeve.coin] ?? [])) {
        rows.push({ ...fill, coin: sleeve.coin });
      }
    }
    rows.sort((a, b) => b.ts - a.ts);
    return rows.slice(0, TRADE_CAP);
  }, [allMarkets, selected, sleeves, tapeByCoin]);

  const scopeCoins = useMemo(
    () => sleeves.map((s) => s.coin).filter((c) => allMarkets || c === selected),
    [allMarkets, selected, sleeves],
  );
  const btLots = useMemo(() => backtestLots(backtest, scopeCoins), [backtest, scopeCoins]);
  const btSummary = useMemo(() => lotSummary(btLots), [btLots]);

  const history = useMemo(() => {
    const rows = [];
    for (const coin of scopeCoins) {
      for (const lot of closedLots(tapeFills(tapeByCoin[coin] ?? []))) {
        rows.push({ ...lot, coin, backtest: false });
      }
    }
    if (showBacktest) for (const lot of btLots) rows.push({ ...lot, backtest: true });
    rows.sort((a, b) => b.ts - a.ts);
    return rows.slice(0, HISTORY_CAP);
  }, [scopeCoins, tapeByCoin, showBacktest, btLots]);

  return (
    <section className={styles.wrap}>
      <div className={styles.tabs} role="tablist" aria-label="계좌 내역">
        <button
          type="button"
          className={tab === "positions" ? styles.tabOn : styles.tab}
          role="tab"
          aria-selected={tab === "positions"}
          onClick={() => setTab("positions")}
        >
          포지션
        </button>
        <button
          type="button"
          className={tab === "trades" ? styles.tabOn : styles.tab}
          role="tab"
          aria-selected={tab === "trades"}
          onClick={() => {
            setTab("trades");
            onNeedMoreTape?.();
          }}
        >
          체결
        </button>
        <button
          type="button"
          className={tab === "history" ? styles.tabOn : styles.tab}
          role="tab"
          aria-selected={tab === "history"}
          onClick={() => {
            setTab("history");
            onNeedMoreTape?.();
          }}
        >
          거래기록
        </button>
        {tab === "trades" || tab === "history" ? (
          <span className={styles.scope}>
            <button
              type="button"
              className={allMarkets ? styles.scopeBtn : styles.scopeOn}
              onClick={() => setAllMarkets(false)}
            >
              {displayCoin(selected)}
            </button>
            <button
              type="button"
              className={allMarkets ? styles.scopeOn : styles.scopeBtn}
              onClick={() => setAllMarkets(true)}
            >
              전체
            </button>
            {tab === "history" && backtest ? (
              <button
                type="button"
                className={showBacktest ? styles.scopeOn : styles.scopeBtn}
                aria-pressed={showBacktest}
                title="bun run backtest(과거 캔들에 전략 규칙 적용)의 가상 거래. 실제 체결이 아니며 Jev 판단도 아닙니다."
                onClick={() => setShowBacktest((v) => !v)}
              >
                백테스트
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {tab === "positions" ? (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>종목</th>
                <th>방향</th>
                <th>수량</th>
                <th>진입가</th>
                <th>현재가</th>
                <th>평가금액</th>
                <th>평가손익</th>
                <th>수익률</th>
                <th>레버리지</th>
              </tr>
            </thead>
            <tbody>
              {waiting && sleeves.length === 0
                ? Array.from({ length: 5 }, (_, i) => (
                    <tr key={i} className={styles.skelRow}>
                      <td><Bone w={36} h={10} /></td>
                      <td><Bone w={40} h={10} /></td>
                      <td><Bone w={72} h={10} /></td>
                      <td><Bone w={56} h={10} /></td>
                      <td><Bone w={56} h={10} /></td>
                      <td><Bone w={52} h={10} /></td>
                      <td><Bone w={56} h={10} /></td>
                      <td><Bone w={28} h={10} /></td>
                      <td><Bone w={28} h={10} /></td>
                    </tr>
                  ))
                : sleeves.map((sleeve) => {
                const latest = latestByCoin[sleeve.coin] ?? null;
                const pos = latest?.position;
                const open = Boolean(pos && pos.side !== "flat" && pos.size > 0);
                const mark = latest?.mid ?? null;
                const value = open && mark != null ? pos!.size * mark : null;
                const u = open ? pos!.unrealizedUsd : 0;
                const roe = roePct(pos);
                const side = SIDE_KO[pos?.side ?? "flat"] ?? "";
                const sideColor =
                  pos?.side === "long" ? "var(--buy-ink)" : pos?.side === "short" ? "var(--sell-ink)" : undefined;
                const pnlColor = open ? (u >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)") : undefined;
                const on = sleeve.coin === selected;
                return (
                  <tr
                    key={sleeve.coin}
                    className={on ? styles.rowOn : undefined}
                    onClick={() => onSelect(sleeve.coin)}
                  >
                    <td>{displayCoin(sleeve.coin)}</td>
                    <td style={sideColor ? { color: sideColor } : undefined}>{side}</td>
                    <td>{open ? fmtCoin(pos!.size, sleeve.coin, 4) : "-"}</td>
                    <td>{open && pos?.entryPrice != null ? fmtPrice(pos.entryPrice) : "-"}</td>
                    <td>{mark != null ? fmtPrice(mark) : "-"}</td>
                    <td>{value != null ? fmtPrice(value) : "-"}</td>
                    <td style={pnlColor ? { color: pnlColor } : undefined}>
                      {open ? fmtSignedUsd(u, 2) : "-"}
                    </td>
                    <td style={pnlColor ? { color: pnlColor } : undefined}>
                      {roe != null ? fmtPct(roe) : "-"}
                    </td>
                    <td>{pos?.leverage != null ? `${pos.leverage}x` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : tab === "history" ? (
        waiting && history.length === 0 ? (
          <div className={styles.scroller} aria-busy="true" aria-label="거래기록 불러오는 중">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>시간</th>
                  <th>종목</th>
                  <th>방향</th>
                  <th>수량</th>
                  <th>진입가</th>
                  <th>청산가</th>
                  <th>손익</th>
                  <th>수수료</th>
                  <th>구분</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className={styles.skelRow}>
                    <td><Bone w={64} h={10} /></td>
                    <td><Bone w={36} h={10} /></td>
                    <td><Bone w={40} h={10} /></td>
                    <td><Bone w={48} h={10} /></td>
                    <td><Bone w={56} h={10} /></td>
                    <td><Bone w={56} h={10} /></td>
                    <td><Bone w={56} h={10} /></td>
                    <td><Bone w={40} h={10} /></td>
                    <td><Bone w={48} h={10} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : history.length === 0 ? (
          <div className={styles.empty}>청산된 거래가 없습니다</div>
        ) : (
          <div className={styles.scroller}>
            {showBacktest && btSummary.trades && backtest ? (
              <div className={styles.btSummary}>
                <span className={styles.btTag}>백테스트 (가상)</span>
                <span>{day(backtest.from)} ~ {day(backtest.to)}</span>
                <span>청산 {btSummary.trades}건</span>
                <span>승률 {Math.round((btSummary.wins / btSummary.trades) * 100)}%</span>
                <span style={{ color: btSummary.netUsd >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)" }}>
                  순손익 {fmtSignedUsd(btSummary.netUsd, 2)}
                </span>
              </div>
            ) : null}
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>시간</th>
                  <th>종목</th>
                  <th>방향</th>
                  <th>수량</th>
                  <th>진입가</th>
                  <th>청산가</th>
                  <th>손익</th>
                  <th>수수료</th>
                  <th>구분</th>
                </tr>
              </thead>
              <tbody>
                {history.map((lot) => {
                  const sideColor = lot.side === "long" ? "var(--buy-ink)" : "var(--sell-ink)";
                  const pnlColor = lot.pnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)";
                  return (
                    <tr key={`${lot.coin}|${lot.key}`} onClick={() => onSelect(lot.coin)}>
                      <td title={lot.openedTs ? `진입 ${fmtDateTime(lot.openedTs)}` : undefined}>{fmtDateTime(lot.ts)}</td>
                      <td>{displayCoin(lot.coin)}</td>
                      <td style={{ color: sideColor }}>{SIDE_KO[lot.side] ?? lot.side}</td>
                      <td>{fmtSize(lot.size)}</td>
                      <td>{lot.entry != null ? fmtPrice(lot.entry) : "-"}</td>
                      <td>{fmtPrice(lot.exit)}</td>
                      <td style={{ color: pnlColor }}>{fmtSignedUsd(lot.pnl, 2)}</td>
                      <td>{lot.fee ? fmtUsd(lot.fee, 2) : "-"}</td>
                      <td className={lot.backtest ? styles.btTag : undefined}>{lot.backtest ? "백테스트" : "봇"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : waiting && trades.length === 0 ? (
        <div className={styles.scroller} aria-busy="true" aria-label="체결 불러오는 중">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>시간</th>
                <th>종목</th>
                <th>방향</th>
                <th>유형</th>
                <th>체결가</th>
                <th>수량</th>
                <th>거래 ID</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className={styles.skelRow}>
                  <td><Bone w={64} h={10} /></td>
                  <td><Bone w={36} h={10} /></td>
                  <td><Bone w={36} h={10} /></td>
                  <td><Bone w={44} h={10} /></td>
                  <td><Bone w={56} h={10} /></td>
                  <td><Bone w={48} h={10} /></td>
                  <td><Bone w={52} h={10} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : trades.length === 0 ? (
        <div className={styles.empty}>체결 내역이 없습니다</div>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>시간</th>
                <th>종목</th>
                <th>방향</th>
                <th>유형</th>
                <th>체결가</th>
                <th>수량</th>
                <th>거래 ID</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((fill) => {
                const sideColor = fill.side === "buy" ? "var(--buy-ink)" : "var(--sell-ink)";
                const action = fill.dir === "open" ? "진입" : fill.dir === "close" ? "청산" : fill.dir === "flip" ? "전환" : "체결";
                return (
                  <tr key={`${fill.coin}|${fill.key}`} onClick={() => onSelect(fill.coin)}>
                    <td>{fmtClock(fill.ts, true)}</td>
                    <td>{displayCoin(fill.coin)}</td>
                    <td style={{ color: sideColor }}>{SIDE_KO[fill.side] ?? fill.side}</td>
                    <td style={{ color: sideColor }}>{action}</td>
                    <td>{fmtPrice(fill.price)}</td>
                    <td>{fmtSize(fill.size)}</td>
                    <td>
                      {fill.hash ? (
                        <a href={txUrl(fill.hash, meta?.explorerTx)} target="_blank" rel="noreferrer">
                          {shortTx(fill.hash)}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
