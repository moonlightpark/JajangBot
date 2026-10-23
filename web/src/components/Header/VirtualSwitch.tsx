"use client";

import { useEffect, useState } from "react";
import type { Meta } from "@/lib/types";
import styles from "./Header.module.css";

const TOKEN_KEY = "jevtrade.adminToken";

const NETWORK_ORDERS: Record<Meta["network"], string> = {
  mainnet: "Bybit 메인넷에 실제 주문을 냅니다. 실제 자금이 움직입니다.",
  testnet: "Bybit 테스트넷에 주문을 냅니다.",
  demo: "Bybit 데모 계정에 주문을 냅니다.",
};

function storedToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private window: ask again next time
  }
}

export interface VirtualSwitchProps {
  apiUrl: string;
  /** Null until meta arrives. */
  meta: Pick<Meta, "dryRun" | "virtual" | "network" | "startedAt"> | null;
}

/**
 * 가상매매 On/Off. On: no real orders, the bot reruns the backtest and carries on as a live dry run.
 * The bot saves the choice and restarts, so the page waits for a new start time.
 */
export default function VirtualSwitch({ apiUrl, meta }: VirtualSwitchProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Start time of the bot that was asked to restart. Cleared once a newer one reports in. */
  const [restartFrom, setRestartFrom] = useState<number | null>(null);

  const startedAt = meta?.startedAt ?? null;
  useEffect(() => {
    if (restartFrom != null && startedAt != null && startedAt !== restartFrom) setRestartFrom(null);
  }, [startedAt, restartFrom]);

  if (!meta) return null;
  // What the bot does now. With no key the bot simulates even when the switch was set off.
  const on = meta.dryRun;
  const canToggle = meta.virtual?.toggle === true;
  const keys = meta.virtual?.keys !== false;
  const next = !on;
  const restarting = restartFrom != null;

  const title = restarting
    ? "봇을 다시 시작하는 중입니다"
    : !canToggle
      ? "봇에 ADMIN_TOKEN이 없어 상태만 표시합니다"
      : on
        ? "가상매매 중: 실제 주문 없이 백테스트 후 실시간 가상매매"
        : "실제 주문 중";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/virtual`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ on: next }),
      });
      if (res.status === 401) {
        storeToken(null);
        setError("비밀번호가 맞지 않습니다.");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { restarting?: boolean; error?: string };
      if (!res.ok) {
        setError(res.status === 409 ? "Bybit API 키가 없어 실제 거래를 할 수 없습니다." : body.error ?? `오류 ${res.status}`);
        return;
      }
      storeToken(token);
      setOpen(false);
      if (body.restarting) setRestartFrom(meta.startedAt);
    } catch {
      setError("봇에 연결하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={styles.virtual}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={styles.switch}
        data-on={on ? "true" : "false"}
        disabled={!canToggle || restarting}
        title={title}
        onClick={() => {
          setToken(storedToken());
          setError(null);
          setOpen((v) => !v);
        }}
      >
        <span className={styles.switchLabel}>가상매매</span>
        <span className={styles.switchTrack} aria-hidden="true">
          <span className={styles.switchKnob} />
        </span>
        <span className={styles.switchState}>{restarting ? "재시작 중" : on ? "On" : "Off"}</span>
      </button>
      {open && canToggle && !restarting ? (
        <form
          className={styles.virtualPanel}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void submit();
          }}
        >
          <p className={styles.virtualText}>
            {next
              ? "가상매매를 켜면 실제 주문을 멈추고, 백테스트 후 실시간 가상매매를 이어갑니다. 지금 가진 실제 포지션은 정리되지 않습니다."
              : keys
                ? `가상매매를 끄면 ${NETWORK_ORDERS[meta.network]}`
                : "Bybit API 키가 없어 실제 거래를 할 수 없습니다."}
          </p>
          <p className={styles.virtualText}>봇이 설정을 저장하고 다시 시작합니다.</p>
          {next || keys ? (
            <>
              <input
                className={styles.virtualInput}
                type="password"
                autoComplete="current-password"
                placeholder="관리자 비밀번호"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
              />
              {error ? <p className={styles.virtualError}>{error}</p> : null}
              <span className={styles.virtualActions}>
                <button type="button" className={styles.virtualCancel} onClick={() => setOpen(false)}>
                  취소
                </button>
                <button type="submit" className={styles.virtualOk} disabled={busy || !token}>
                  {next ? "가상매매 켜기" : "가상매매 끄기"}
                </button>
              </span>
            </>
          ) : (
            <span className={styles.virtualActions}>
              <button type="button" className={styles.virtualCancel} onClick={() => setOpen(false)}>
                닫기
              </button>
            </span>
          )}
        </form>
      ) : null}
    </span>
  );
}
