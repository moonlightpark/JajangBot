"use client";

import { useMemo, useState } from "react";
import type { BlockEvent, Meta, PricePoint, SleeveMeta } from "@/lib/types";
import type { BacktestReport, DailyReport } from "@/lib/bot-types";
import { backtestLots, lotSummary } from "@/lib/backtest";
import { closedLots, tapeFills, withBalance, type TapeFill } from "@/lib/fills";
import { leverageView } from "@/lib/limits";
import { roePct } from "@/lib/pnl";
import { displayCoin, fmtClock, fmtCoin, fmtDateTime, fmtPct, fmtPrice, fmtSignedUsd, fmtUsd, shortTx, SIDE_KO, txUrl } from "@/lib/format";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./Book.module.css";

type Tab = "positions" | "trades" | "history" | "daily";

const TRADE_CAP = 200;
/** Three months of backtest trades on every coin fit, with room for the bot's own. */
const HISTORY_CAP = 2000;

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10).replaceAll("-", ".");

/** Size with the order amount at the entry price: "0.012($300)". */
function fmtSizeUsd(size: number, px: number | null | undefined): string {
  const usd = px != null && px > 0 ? size * px : null;
  return usd != null ? `${fmtSize(size)}($${Math.round(usd).toLocaleString("en-US")})` : fmtSize(size);
}

/** "$25,686", with thousands commas, for the limit bar. */
function usdComma(n: number, d = 0): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

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
  onFocusTrade,
  onNeedMoreTape,
  backtest = null,
  waiting = false,
  height,
  reports = [],
}: {
  sleeves: SleeveMeta[];
  latestByCoin: Record<string, BlockEvent | null>;
  tapeByCoin: Record<string, PricePoint[]>;
  selected: string;
  meta?: Meta | null;
  onSelect: (coin: string) => void;
  /** A 거래기록 row was clicked: show that trade, entry to exit, on the chart. */
  onFocusTrade?: (coin: string, fromMs: number, toMs: number) => void;
  onNeedMoreTape?: () => void;
  /** Last `bun run backtest` run. Its closed trades are listed in History, marked as backtest. */
  backtest?: BacktestReport | null;
  waiting?: boolean;
  /** Set by dragging the bar above the panel. Unset: the stylesheet's height. */
  height?: number | null;
  /** The bot's daily reports, newest first. */
  reports?: DailyReport[];
}) {
  const [tab, setTab] = useState<Tab>("positions");
  const [allMarkets, setAllMarkets] = useState(false);
  const [showBacktest, setShowBacktest] = useState(true);
  const [focusedRow, setFocusedRow] = useState<string | null>(null);

  const limits = useMemo(() => leverageView(latestByCoin[selected] ?? null, meta?.risk), [latestByCoin, selected, meta?.risk]);

  const trades = useMemo(() => {
    const rows: (TapeFill & { coin: string; round?: number })[] = [];
    for (const sleeve of sleeves) {
      if (!allMarkets && sleeve.coin !== selected) continue;
      for (const fill of tapeFills(tapeByCoin[sleeve.coin] ?? [])) {
        rows.push({ ...fill, coin: sleeve.coin });
      }
      // The position the dry run carried on from the backtest: its entries were never bot fills.
      const carried = sleeve.carried;
      (carried?.entries ?? []).forEach((e, i) => {
        rows.push({
          key: `carried|${e.ts}|${e.px}|${e.size}`,
          ts: e.ts,
          side: carried!.side === "long" ? "buy" : "sell",
          price: e.px,
          size: e.size,
          dir: "open",
          coin: sleeve.coin,
          round: e.round ?? i + 1,
        });
      });
    }
    rows.sort((a, b) => b.ts - a.ts);
    return rows.slice(0, TRADE_CAP);
  }, [allMarkets, selected, sleeves, tapeByCoin]);

  const scopeCoins = useMemo(
    () => sleeves.map((s) => s.coin).filter((c) => allMarkets || c === selected),
    [allMarkets, selected, sleeves],
  );
  // The balance live trading started from: the dry run's start plus the backtest's closed PnL.
  // Left out with a wallet, which reports no start.
  const tradeStart = useMemo(() => {
    const sleeve = sleeves.find((s) => s.coin === selected);
    if (sleeve?.startUsd == null) return null;
    return { startUsd: sleeve.startUsd, backtestUsd: sleeve.backtestUsd ?? 0 };
  }, [sleeves, selected]);
  const btLots = useMemo(() => backtestLots(backtest, scopeCoins), [backtest, scopeCoins]);
  const btSummary = useMemo(() => lotSummary(btLots), [btLots]);

  // Dry run sleeves start from a known share, so each row can show the balance after it.
  // A wallet sleeve has no start on the wire: its rows show no balance.
  const startUsd = useMemo(() => {
    let sum = 0;
    for (const coin of scopeCoins) {
      const start = sleeves.find((s) => s.coin === coin)?.startUsd;
      if (start == null) return null;
      sum += start;
    }
    return scopeCoins.length ? sum : null;
  }, [scopeCoins, sleeves]);

  const history = useMemo(() => {
    const rows = [];
    for (const coin of scopeCoins) {
      const carried = sleeves.find((s) => s.coin === coin)?.carried;
      for (const lot of closedLots(tapeFills(tapeByCoin[coin] ?? []), carried)) {
        rows.push({ ...lot, coin, backtest: false });
      }
    }
    // Backtest trades always count toward the balance (it runs on from them), even when hidden.
    for (const lot of btLots) rows.push({ ...lot, backtest: true });
    const all = startUsd == null ? rows.map((r) => ({ ...r, balance: null as number | null })) : withBalance(rows, startUsd);
    const shown = showBacktest ? all : all.filter((r) => !r.backtest);
    shown.sort((a, b) => b.ts - a.ts);
    return shown.slice(0, HISTORY_CAP);
  }, [scopeCoins, tapeByCoin, showBacktest, btLots, startUsd, sleeves]);

  return (
    <section className={styles.wrap} data-book style={height != null ? { height } : undefined}>
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
        <button
          type="button"
          className={tab === "daily" ? styles.tabOn : styles.tab}
          role="tab"
          aria-selected={tab === "daily"}
          onClick={() => setTab("daily")}
        >
          일일 보고
        </button>
        {tab === "trades" || tab === "history" || tab === "daily" ? (
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
          {limits ? (
            <div className={styles.btSummary}>
              {tradeStart ? (
                <span
                  title={`가상매매를 시작할 때의 잔고. 시작 자금 ${usdComma(tradeStart.startUsd, 2)}에 백테스트 손익 ${tradeStart.backtestUsd < 0 ? "-" : "+"}${usdComma(Math.abs(tradeStart.backtestUsd), 2)}를 더한 금액입니다.`}
                >
                  시작 잔고 {usdComma(tradeStart.startUsd + tradeStart.backtestUsd, 2)}
                </span>
              ) : null}
              <span title="보유 포지션(현재가 기준) ÷ 잔고. 주문에 쓰는 레버리지(아래 표의 레버리지)는 Bybit가 묶어 두는 증거금만 정합니다.">
                계좌 레버리지 <b>{limits.leverage.toFixed(2)}배</b>
                {limits.maxLeverage != null ? ` (한도 ${limits.maxLeverage}배)` : ""}
              </span>
              <span>잔고 {usdComma(limits.equityUsd, 2)}</span>
              <span>보유 {usdComma(limits.positionUsd)}</span>
              {limits.limitUsd != null ? (
                <>
                  <span title="MAX_ACCOUNT_LEVERAGE × 현재 잔고. 잔고가 바뀌면 다음 주문 때 다시 계산합니다.">포지션 한도 {usdComma(limits.limitUsd)}</span>
                  <span>남은 한도 {usdComma(limits.roomUsd ?? 0)}</span>
                  <span title="한도를 진입 회차 수로 나눈 금액, 남은 한도보다 크면 남은 한도만큼. 거래소 최소 주문보다 작으면 주문하지 않습니다.">
                    다음 주문 {usdComma(limits.nextOrderUsd ?? 0)}
                  </span>
                </>
              ) : (
                <span>포지션 한도 없음 (MAX_ACCOUNT_LEVERAGE 미설정)</span>
              )}
            </div>
          ) : null}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>종목</th>
                <th>방향</th>
                <th>수량/주문금액</th>
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
                    <td>
                      {open
                        ? `${fmtCoin(pos!.size, sleeve.coin, 4)}${pos?.entryPrice != null && pos.entryPrice > 0 ? ` / $${Math.round(pos.size * pos.entryPrice).toLocaleString("en-US")}` : ""}`
                        : "-"}
                    </td>
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
                  <th>수량/주문금액</th>
                  <th>진입가</th>
                  <th>청산가</th>
                  <th>손익</th>
                  <th title="그 거래가 청산된 뒤의 잔액. 시작 금액에 수수료를 뺀 손익을 차례로 더한 값입니다.">잔액</th>
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
                    <td><Bone w={64} h={10} /></td>
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
                  <th>수량/주문금액</th>
                  <th>진입가</th>
                  <th>청산가</th>
                  <th>손익</th>
                  <th title="그 거래가 청산된 뒤의 잔액. 시작 금액에 수수료를 뺀 손익을 차례로 더한 값입니다.">잔액</th>
                  <th>수수료</th>
                  <th>구분</th>
                </tr>
              </thead>
              <tbody>
                {history.map((lot) => {
                  const sideColor = lot.side === "long" ? "var(--buy-ink)" : "var(--sell-ink)";
                  const pnlColor = lot.pnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)";
                  const rowKey = `${lot.coin}|${lot.backtest ? "bt" : "bot"}|${lot.key}`;
                  return (
                    <tr
                      key={rowKey}
                      className={rowKey === focusedRow ? styles.rowOn : undefined}
                      title="클릭하면 차트에서 이 거래 구간을 봅니다"
                      onClick={() => {
                        setFocusedRow(rowKey);
                        if (onFocusTrade) onFocusTrade(lot.coin, lot.openedTs ?? lot.ts, lot.ts);
                        else onSelect(lot.coin);
                      }}
                    >
                      <td title={lot.openedTs ? `진입 ${fmtDateTime(lot.openedTs)}` : undefined}>{fmtDateTime(lot.ts)}</td>
                      <td>{displayCoin(lot.coin)}</td>
                      <td style={{ color: sideColor }}>{SIDE_KO[lot.side] ?? lot.side}</td>
                      <td>{fmtSizeUsd(lot.size, lot.entry ?? lot.exit)}</td>
                      <td>{lot.entry != null ? fmtPrice(lot.entry) : "-"}</td>
                      <td>{fmtPrice(lot.exit)}</td>
                      <td style={{ color: pnlColor }}>{fmtSignedUsd(lot.pnl, 2)}</td>
                      <td>{lot.balance != null ? fmtUsd(lot.balance, 2) : "-"}</td>
                      <td>{lot.fee ? fmtUsd(lot.fee, 2) : "-"}</td>
                      <td className={lot.backtest ? styles.btTag : undefined}>{lot.backtest ? "백테스트" : "봇"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : tab === "daily" ? (
        reports.length === 0 ? (
          <div className={styles.empty}>
            아직 일일 보고가 없습니다. 봇 설정 DAILY_REPORT_HOUR_KST(예: 23)를 켜면 매일 그 시각(한국시간)에 하루 마감 보고가 쌓입니다.
          </div>
        ) : (
          <div className={styles.scroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>종목</th>
                  <th>시작 잔고</th>
                  <th>마감 잔고</th>
                  <th>손익</th>
                  <th>실현손익</th>
                  <th>수수료</th>
                  <th>진입</th>
                  <th>청산</th>
                  <th title="리스크 감시(코드)가 낸 청산 수">리스크 청산</th>
                  <th title="판단 가격 대비 체결가, 평균 / 최대. +는 불리한 쪽">슬리피지</th>
                  <th>마감 포지션</th>
                </tr>
              </thead>
              <tbody>
                {reports
                  .filter((r) => allMarkets || r.coin === selected)
                  .map((r) => {
                    const color = r.pnlUsd >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)";
                    return (
                      <tr key={`${r.coin}|${r.date}|${r.to}`} onClick={() => onSelect(r.coin)}>
                        <td title={`${fmtDateTime(r.from)} ~ ${fmtDateTime(r.to)}${r.sinceStart ? " (봇 시작 이후만)" : ""}`}>
                          {r.date}
                          {r.sinceStart ? " *" : ""}
                        </td>
                        <td>{displayCoin(r.coin)}</td>
                        <td>{fmtUsd(r.startBalance, 2)}</td>
                        <td>{fmtUsd(r.endBalance, 2)}</td>
                        <td style={{ color }}>
                          {fmtSignedUsd(r.pnlUsd, 2)} ({r.pnlPct > 0 ? "+" : ""}{r.pnlPct}%)
                        </td>
                        <td>{fmtSignedUsd(r.realizedUsd, 2)}</td>
                        <td>{fmtUsd(r.feesUsd, 2)}</td>
                        <td>{r.entries}</td>
                        <td>{r.closes}</td>
                        <td>{r.riskCloses}</td>
                        <td>{r.avgSlipBps != null ? `${r.avgSlipBps}bp / ${r.maxSlipBps}bp` : "-"}</td>
                        <td>
                          {r.open ? `${SIDE_KO[r.open.side] ?? r.open.side} ${fmtSize(r.open.size)} @ ${fmtPrice(r.open.entryPx)}` : "없음"}
                        </td>
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
                <th>슬리피지</th>
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
                  <td><Bone w={40} h={10} /></td>
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
                <th>슬리피지</th>
                <th>거래 ID</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((fill) => {
                const sideColor = fill.side === "buy" ? "var(--buy-ink)" : "var(--sell-ink)";
                const action = fill.round != null ? `${fill.round}차 진입` : fill.risk ? (fill.risk === "volume" ? "거래량 청산" : "리스크 손절") : fill.dir === "open" ? "진입" : fill.dir === "close" ? "청산" : fill.dir === "flip" ? "전환" : "체결";
                return (
                  <tr key={`${fill.coin}|${fill.key}`} onClick={() => onSelect(fill.coin)}>
                    <td title={fmtClock(fill.ts, true)}>{fmtDateTime(fill.ts)}</td>
                    <td>{displayCoin(fill.coin)}</td>
                    <td style={{ color: sideColor }}>{SIDE_KO[fill.side] ?? fill.side}</td>
                    <td style={{ color: sideColor }}>{action}</td>
                    <td>{fmtPrice(fill.price)}</td>
                    <td>{fmtSize(fill.size)}</td>
                    <td
                      style={fill.slipBps != null && fill.slipBps > 0 ? { color: "var(--pnl-neg)" } : undefined}
                      title="판단한 순간의 가격(중간가) 대비 체결가. +는 불리하게(더 비싸게 사거나 더 싸게 팔아) 체결된 것입니다. 1bp는 0.01%입니다."
                    >
                      {fill.slipBps != null ? `${fill.slipBps > 0 ? "+" : ""}${fill.slipBps.toFixed(1)}bp` : "-"}
                    </td>
                    <td>
                      {fill.round != null ? (
                        <span className={styles.btTag} title="봇이 시작할 때 백테스트에서 이어받은 포지션의 진입입니다. 백테스트(1분 단위) 기준 시각과 가격입니다.">
                          백테스트에서 이어받음
                        </span>
                      ) : fill.hash ? (
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
