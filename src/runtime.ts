import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Settings changed from the dashboard, kept across restarts. Overrides .env.
 * Only the 가상매매 (dry run) switch for now. Gitignored.
 */
export const RUNTIME_FILE = ".runtime.json";

type Runtime = { dryRun?: boolean };

export function readRuntime(file = RUNTIME_FILE): Runtime {
  try {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    return typeof raw.dryRun === "boolean" ? { dryRun: raw.dryRun } : {};
  } catch {
    return {};
  }
}

export function writeRuntime(next: Runtime, file = RUNTIME_FILE): void {
  writeFileSync(file, JSON.stringify({ ...readRuntime(file), ...next }, null, 2) + "\n");
}

/** The dashboard's switch when it was used, else DRY_RUN from .env. */
export function resolveDryRun(envValue: string | undefined, runtime: Runtime): boolean {
  return runtime.dryRun ?? envValue === "true";
}

/** Constant time, so a wrong guess learns nothing from the reply time. Empty `expected` never matches. */
export function tokenMatches(expected: string, given: string | null | undefined): boolean {
  if (!expected || !given) return false;
  const hash = (x: string) => createHash("sha256").update(x).digest();
  return timingSafeEqual(hash(expected), hash(given));
}
