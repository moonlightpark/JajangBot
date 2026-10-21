"use client";

import type { BlockEvent, Meta } from "@/lib/types";
import { fmtCall, fmtPct, LATE_KO } from "@/lib/format";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./DecisionPanel.module.css";

export interface DecisionPanelProps {
  latest: BlockEvent | null;
  meta?: Meta | null;
  waiting?: boolean;
}

interface BarRowProps {
  label: string;
  labelColor: string;
  active: boolean;
  value: number;
  fill: string;
  pct: string;
}

function BarRow({ label, labelColor, active, value, fill, pct }: BarRowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.label} style={{ color: labelColor, opacity: active ? 1 : 0.38 }}>
        {label}
      </span>
      <div className={styles.track}>
        <div
          className={styles.fill}
          style={{
            width: `${Math.max(0, Math.min(1, value)) * 100}%`,
            background: fill,
          }}
        />
      </div>
      <span className={styles.pct}>{pct}</span>
    </div>
  );
}

export default function DecisionPanel({ latest, waiting = false }: DecisionPanelProps) {
  if (waiting && !latest) {
    return (
      <div className={styles.panel} aria-busy="true" aria-label="판단 불러오는 중">
        <section className={styles.section}>
          <div className={styles.railHead}>현재 판단</div>
          <div className={styles.body}>
            <div className={styles.headline}>
              <Bone w={72} h={22} />
              <span className={styles.metaLine}>
                <Bone w={40} h={10} />
              </span>
            </div>
            <div className={styles.bars}>
              {["롱", "숏", "진입", "청산", "관망"].map((label) => (
                <div key={label} className={styles.row}>
                  <span className={styles.label} style={{ opacity: 0.38 }}>
                    {label}
                  </span>
                  <div className={styles.track} />
                  <span className={styles.pct}>
                    <Bone w={28} h={10} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  }

  const decision = latest?.decision ?? null;
  const late = decision ? decision.late : true;
  const held = decision?.intent === "hold";
  const chosen =
    decision && !decision.late && !held && decision.action !== "hold"
      ? (decision.bias ?? decision.action)
      : null;

  const probs = decision?.probabilities ?? { buy: 0, sell: 0, hold: 0 };
  // A hold is a real answer, so its bars stay readable instead of greying out.
  const decided = decision !== null && !late && (chosen !== null || held);
  const pctOf = (p: number | undefined) => (decided ? fmtPct(p ?? 0) : "-");

  const headline = decided ? fmtCall(decision) || LATE_KO : LATE_KO;
  const headlineColor = held
    ? "var(--ink-2)"
    : chosen
      ? (decision?.bias ?? decision?.action) === "short" || decision?.action === "sell"
        ? "var(--sell-ink)"
        : "var(--buy-ink)"
      : "var(--late-ink)";

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.railHead}>현재 판단</div>
        <div className={styles.body}>
          <div className={styles.headline}>
            <span className={styles.headlineWord} style={{ color: headlineColor }}>
              {headline}
            </span>
            {decided && decision ? (
              <span className={styles.metaLine}>{decision.latencyMs} ms</span>
            ) : null}
          </div>

          <div className={styles.bars}>
            <BarRow
              label="롱"
              labelColor="var(--buy-ink)"
              active={!held && decision?.bias === "long"}
              value={probs.long ?? probs.buy}
              fill={!held && decision?.bias === "long" ? "var(--buy-bar)" : "var(--buy-bar-dim)"}
              pct={pctOf(probs.long ?? probs.buy)}
            />
            <BarRow
              label="숏"
              labelColor="var(--sell-ink)"
              active={!held && decision?.bias === "short"}
              value={probs.short ?? probs.sell}
              fill={!held && decision?.bias === "short" ? "var(--sell-bar)" : "var(--sell-bar-dim)"}
              pct={pctOf(probs.short ?? probs.sell)}
            />
            <BarRow
              label="진입"
              labelColor="var(--ink)"
              active={decision?.intent === "open"}
              value={probs.open ?? 0}
              fill={decision?.intent === "open" ? "var(--buy-bar)" : "var(--buy-bar-dim)"}
              pct={pctOf(probs.open)}
            />
            <BarRow
              label="청산"
              labelColor="var(--ink)"
              active={decision?.intent === "close"}
              value={probs.close ?? 0}
              fill={decision?.intent === "close" ? "var(--sell-bar)" : "var(--sell-bar-dim)"}
              pct={pctOf(probs.close)}
            />
            <BarRow
              label="관망"
              labelColor="var(--ink)"
              active={held}
              value={probs.hold ?? 0}
              fill={held ? "var(--ink-2)" : "var(--hold-cell)"}
              pct={pctOf(probs.hold)}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
