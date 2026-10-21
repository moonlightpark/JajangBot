"use client";

import { fmtSignedUsd, fmtUsd } from "@/lib/format";
import type { TradingMode } from "@/lib/mode";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./Header.module.css";

export interface HeaderProps {
  connection: "connecting" | "live" | "reconnecting";
  balance: number | null;
  unrealized: number | null;
  realized: number | null;
  /** Dry run: closed backtest PnL already inside `balance`. Null hides it. */
  backtest?: number | null;
  /** Open backtest trades marked at the live price. Shown on its own, not in `balance`. Null hides it. */
  backtestOpen?: number | null;
  /** From the bot's .env: 실거래, 테스트넷, 데모, or 모의거래. Null until meta arrives. */
  mode: TradingMode | null;
  /** Who makes the call: Jev, 모의 모델, or TradingView 전략. */
  decider: string | null;
}

function Score({
  label,
  value,
  signed = true,
  title,
}: {
  label: string;
  value: number | null;
  signed?: boolean;
  title?: string;
}) {
  const color = !signed || value == null ? undefined : value >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)";
  return (
    <span className={styles.score} title={title}>
      <span className={styles.scoreKey}>{label}</span>
      <span className={styles.scoreVal} style={color ? { color } : undefined}>
        {value == null ? <Bone w={64} h={16} /> : signed ? fmtSignedUsd(value, 2) : fmtUsd(value, 2)}
      </span>
    </span>
  );
}

export default function Header({ connection, balance, unrealized, realized, backtest = null, backtestOpen = null, mode, decider }: HeaderProps) {
  const live = connection === "live";
  const label = !live ? "연결 끊김" : mode ? mode.label : "연결 중";

  return (
    <div className={styles.header}>
      <span className={styles.brandLockup}>
        <p className={styles.tagline}>실시간 트레이딩 봇</p>
      </span>
      <span
        className={styles.status}
        data-live={live ? "true" : "false"}
        data-real={live && mode?.real ? "true" : "false"}
        title={live && mode ? mode.detail : undefined}
      >
        <span className={styles.dot} aria-hidden="true" />
        <span>{label}</span>
        {live && mode ? <span className={styles.statusDetail}>{mode.detail}</span> : null}
        {live && decider ? <span className={styles.decider} data-jev={decider === "Jev" ? "true" : "false"}>{decider} 판단</span> : null}
      </span>
      <span className={styles.scores}>
        <Score label="잔고" value={balance} signed={false} />
        {backtest != null ? (
          <Score
            label="백테스트"
            value={backtest}
            title="bun run backtest(과거 캔들에 전략 규칙 적용)로 청산된 가상 거래 손익. 잔고에 포함. 모의거래에서만 표시."
          />
        ) : null}
        {backtestOpen != null ? (
          <Score
            label="백테스트 평가손익"
            value={backtestOpen}
            title="백테스트에서 아직 청산되지 않은 가상 포지션을 현재가로 평가한 손익(진입 수수료 포함). 잔고에 포함하지 않음. 봇의 실제 포지션과는 별개."
          />
        ) : null}
        <Score label="평가손익" value={unrealized} />
        <Score label="실현손익" value={realized} />
      </span>
    </div>
  );
}
