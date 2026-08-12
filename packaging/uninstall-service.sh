#!/usr/bin/env bash
# Stops and removes the github-notifier user service. Leaves MongoDB data and
# the keyring entry alone.
set -euo pipefail

UNIT_NAME="github-notifier.service"
USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

systemctl --user disable --now "$UNIT_NAME" 2>/dev/null || true
rm -f "$USER_UNIT_DIR/$UNIT_NAME"
systemctl --user daemon-reload

echo "Service removed."
echo "Config and secrets are still in ${XDG_CONFIG_HOME:-$HOME/.config}/github-notifier"
echo "Notification history is still in MongoDB (database: github_notifier)"
