#!/usr/bin/env bash
# One-time setup for a Raspberry Pi 5 plugged into a TV (Raspberry Pi OS Bookworm, 64-bit, desktop).
# Run as your normal user from the repo:  ./scripts/pi/install.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_DIR"

if [ "$(id -u)" = 0 ]; then
  echo "Run this as your normal desktop user (it uses sudo where needed)." >&2
  exit 1
fi

echo "==> System packages (mpv, CEC tools, Chromium)"
sudo apt-get update
sudo apt-get install -y mpv v4l-utils ir-keytable curl
command -v chromium >/dev/null || command -v chromium-browser >/dev/null || sudo apt-get install -y chromium

echo "==> Node.js"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo
  echo "Created $APP_DIR/.env — add your TMDB token, Trakt app keys and (optionally) your Stremio"
  echo "login / debrid addon URLs, then run this script again. The web app is built with these values."
  exit 0
fi

echo "==> Building the app"
npm ci
npm run build

echo "==> Start on boot (desktop autologin + kiosk)"
sudo raspi-config nonint do_boot_behaviour B4 || echo "  (couldn't set desktop autologin — enable it in raspi-config)"
chmod +x scripts/pi/*.sh
if command -v labwc >/dev/null; then
  mkdir -p ~/.config/labwc
  touch ~/.config/labwc/autostart
  grep -q "scripts/pi/kiosk.sh" ~/.config/labwc/autostart || echo "$APP_DIR/scripts/pi/kiosk.sh &" >>~/.config/labwc/autostart
else
  mkdir -p ~/.config/autostart
  cat >~/.config/autostart/media-hub.desktop <<DESKTOP
[Desktop Entry]
Type=Application
Name=Media Hub
Exec=$APP_DIR/scripts/pi/kiosk.sh
X-GNOME-Autostart-enabled=true
DESKTOP
fi

echo "==> TV remote over HDMI-CEC"
sudo tee /etc/systemd/system/media-hub-cec.service >/dev/null <<UNIT
[Unit]
Description=Media Hub TV remote (HDMI-CEC)
After=multi-user.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$APP_DIR/scripts/pi/cec-remote.sh

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable media-hub-cec.service
sudo systemctl restart media-hub-cec.service || true

echo
echo "Done. Reboot to start Media Hub on the TV:  sudo reboot"
echo "Logs: ~/.cache/media-hub/server.log   ·   Test the remote: sudo ir-keytable -t"
