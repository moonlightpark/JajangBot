#!/usr/bin/env bash
# One-time setup on an Ubuntu server. Run with sudo from the deploy user's account:
#   sudo bash deploy/setup-server.sh
# Then put .env in $APP_DIR, run deploy/deploy.sh as the deploy user, and once DNS points here:
#   sudo certbot --nginx -d www.gpurent.io -d gpurent.io -d api.gpurent.io
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run with sudo: sudo bash $0" >&2
  exit 1
fi

DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:?run with sudo from the deploy user}}"
USER_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
APP_DIR="${APP_DIR:-$USER_HOME/jevtrade}"
REPO="${REPO:-https://github.com/moonlightpark/JajangBot.git}"
BUN="$USER_HOME/.bun/bin/bun"
as_user() { sudo -u "$DEPLOY_USER" -H "$@"; }

apt-get update -y
apt-get install -y git curl unzip nginx certbot python3-certbot-nginx

if [ ! -x "$BUN" ]; then
  as_user bash -c 'curl -fsSL https://bun.sh/install | bash'
fi

if [ ! -d "$APP_DIR/.git" ]; then
  as_user git clone "$REPO" "$APP_DIR"
fi

# systemd units, filled in for this user and path
for unit in jevtrade-bot jevtrade-web; do
  sed -e "s|__USER__|$DEPLOY_USER|g" -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__BUN__|$BUN|g" \
    "$APP_DIR/deploy/systemd/$unit.service" > "/etc/systemd/system/$unit.service"
done
systemctl daemon-reload
systemctl enable jevtrade-bot jevtrade-web

# deploy.sh restarts the services without a password prompt, and nothing else.
cat > /etc/sudoers.d/jevtrade <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart jevtrade-bot jevtrade-web, /usr/bin/systemctl --no-pager status jevtrade-bot jevtrade-web
EOF
chmod 440 /etc/sudoers.d/jevtrade
visudo -cf /etc/sudoers.d/jevtrade

# nginx: copied once, so certbot's 443 edits survive later deploys
if [ ! -f /etc/nginx/sites-available/gpurent.conf ]; then
  cp "$APP_DIR/deploy/nginx/gpurent.conf" /etc/nginx/sites-available/gpurent.conf
fi
ln -sf /etc/nginx/sites-available/gpurent.conf /etc/nginx/sites-enabled/gpurent.conf
nginx -t
systemctl reload nginx

if [ ! -f "$APP_DIR/.env" ]; then
  echo "Next: copy .env to $APP_DIR/.env (set HOST=127.0.0.1), then run bash $APP_DIR/deploy/deploy.sh"
fi
