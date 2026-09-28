#!/usr/bin/env bash
# Starts the Media Hub server (restarting it if it dies) and opens the app full-screen on the TV.
# Launched from the desktop session's autostart so mpv inherits the display.
set -u
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/media-hub"
mkdir -p "$LOG_DIR"

# Only one kiosk at a time.
exec 9>"$LOG_DIR/kiosk.lock"
flock -n 9 || exit 0

env_value() { grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2-; }
PORT="$(env_value PORT)"; PORT="${PORT:-8787}"
SCALE="$(env_value MEDIAHUB_SCALE)"; SCALE="${SCALE:-1}"

(
  cd "$APP_DIR"
  while true; do
    NODE_ENV=production node server/index.mjs >>"$LOG_DIR/server.log" 2>&1
    echo "$(date) server exited, restarting" >>"$LOG_DIR/server.log"
    sleep 2
  done
) &

for _ in $(seq 1 100); do
  curl -fs "http://localhost:$PORT/api/player/status" >/dev/null && break
  sleep 0.2
done

CHROMIUM="$(command -v chromium || command -v chromium-browser)"
exec "$CHROMIUM" \
  --kiosk --noerrdialogs --disable-infobars --no-first-run --disable-session-crashed-bubble \
  --password-store=basic --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --disable-features=HardwareMediaKeyHandling,Translate \
  --force-device-scale-factor="$SCALE" \
  "http://localhost:$PORT/?tv=1"
