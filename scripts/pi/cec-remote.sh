#!/usr/bin/env bash
# Makes the TV remote drive Media Hub over HDMI-CEC (no extra hardware).
# The Pi registers as a CEC playback device; the kernel turns remote presses into input events,
# and we remap them with cec-keymap.toml so arrows / OK / Back / digits reach Chromium and mpv.
set -u
KEYMAP="$(cd "$(dirname "$0")" && pwd)/cec-keymap.toml"

configured=0
for dev in /dev/cec*; do
  [ -e "$dev" ] || continue
  if cec-ctl -d "$dev" --playback --osd-name "Media Hub" >/dev/null 2>&1; then
    configured=1
    # Wake the TV and switch its input to the Pi (ignored by TVs that don't support it).
    cec-ctl -d "$dev" --to 0 --image-view-on >/dev/null 2>&1 || true
  fi
done
if [ "$configured" = 0 ]; then
  echo "media-hub: no HDMI-CEC adapter found (is the TV on the Pi's HDMI port?)" >&2
  exit 0
fi

# Give the kernel a moment to create the CEC remote-control devices.
sleep 2
mapped=0
for rc in /sys/class/rc/rc*; do
  [ -e "$rc/protocols" ] && grep -q cec "$rc/protocols" || continue
  ir-keytable -s "$(basename "$rc")" -c -w "$KEYMAP" && mapped=1
done
[ "$mapped" = 1 ] || echo "media-hub: CEC is up but no CEC remote device was found to remap" >&2
exit 0
