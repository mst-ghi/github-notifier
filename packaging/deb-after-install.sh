#!/bin/bash
# Runs as root after `dpkg -i`. Installs the systemd *user* unit system-wide so
# every user can enable it, and fixes up the chrome-sandbox permissions.
#
# Note: electron-builder expands ${...} in this file as its own template macro,
# so this script deliberately uses plain $var and $(...) only.
set -e

APP_DIR="/opt/GitHub Notifier"
UNIT_SRC="$APP_DIR/resources/systemd/github-notifier.service"
UNIT_DEST="/usr/lib/systemd/user/github-notifier.service"

if [ -f "$APP_DIR/chrome-sandbox" ]; then
  chown root:root "$APP_DIR/chrome-sandbox"
  chmod 4755 "$APP_DIR/chrome-sandbox"
fi

if [ -f "$UNIT_SRC" ]; then
  mkdir -p /usr/lib/systemd/user
  install -m 0644 "$UNIT_SRC" "$UNIT_DEST"
  systemctl daemon-reload 2>/dev/null || true
fi

# Make the icon available to the desktop and to notify-send. The file names are
# already "<size>x<size>.png", so the directory name comes straight from them.
for src in "$APP_DIR"/resources/build/icons/*.png; do
  [ -f "$src" ] || continue
  size_dir=$(basename "$src" .png)
  dest_dir="/usr/share/icons/hicolor/$size_dir/apps"
  mkdir -p "$dest_dir"
  install -m 0644 "$src" "$dest_dir/github-notifier.png"
done
gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true

cat <<'EOF'

GitHub Notifier installed.

Start the background service (as your normal user, not root):
  systemctl --user enable --now github-notifier
  journalctl --user -u github-notifier -f

It needs MongoDB running on localhost:27017.
EOF

exit 0
