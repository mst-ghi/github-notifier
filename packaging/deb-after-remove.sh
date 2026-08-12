#!/bin/bash
# Runs as root after the package is removed.
set -e

rm -f /usr/lib/systemd/user/github-notifier.service
rm -f /usr/share/icons/hicolor/*/apps/github-notifier.png
gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
systemctl daemon-reload 2>/dev/null || true

echo "GitHub Notifier removed. Per-user services may still be enabled:"
echo "  systemctl --user disable --now github-notifier"

exit 0
