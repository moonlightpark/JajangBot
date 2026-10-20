#!/usr/bin/env bash
# Runs on the server. Checks out a commit, builds, restarts both services.
#   bash deploy/deploy.sh [commit]     (default: origin/main)
# GitHub Actions runs it on every push to main (.github/workflows/deploy.yml).
# Everything sits in main() so bash has read the whole script before git rewrites it.
set -euo pipefail

main() {
  local app_dir="${APP_DIR:-$HOME/jevtrade}"
  local api_url="${API_URL:-https://api.gpurent.io}"
  local ref="${1:-origin/main}"
  export PATH="$HOME/.bun/bin:$PATH"

  cd "$app_dir"
  git fetch --quiet origin main
  # .env and backtest-results/ are untracked, so the reset leaves them alone.
  git reset --hard --quiet "$ref"
  echo "deploying $(git log -1 --format='%h %s')"

  bun install --frozen-lockfile
  (
    cd web
    bun install --frozen-lockfile
    # NEXT_PUBLIC_* is baked in at build time.
    NEXT_PUBLIC_API_URL="$api_url" bun --bun next build
  )

  sudo systemctl restart jevtrade-bot jevtrade-web

  local port
  port="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"
  port="${port:-3000}"
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${port}/" >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3001/ >/dev/null 2>&1; then
      echo "bot :${port} and web :3001 are up"
      return 0
    fi
    sleep 2
  done
  echo "services did not come up in 120s" >&2
  sudo systemctl --no-pager status jevtrade-bot jevtrade-web | tail -40 >&2
  return 1
}

main "$@"
