#!/usr/bin/env bash
# Installs and starts the github-notifier user service.
#
# Works in two modes:
#   - installed:   the .deb is present under /opt, use Electron's bundled node
#   - development: run from a git checkout, use the system node and dist/
set -euo pipefail

UNIT_NAME="github-notifier.service"
USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
INSTALL_DIR="/opt/GitHub Notifier"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "$USER_UNIT_DIR"

SYSTEM_UNIT="/usr/lib/systemd/user/$UNIT_NAME"

if [[ -x "$INSTALL_DIR/github-notifier" ]]; then
  echo "Found packaged install at $INSTALL_DIR"

  # A unit in the user's own config directory silently takes precedence over the
  # one the .deb installed. That is useful when the packaged unit is out of date
  # — an older .deb, or one built before a fix — but dangerous when it is merely
  # left over, because it keeps running a stale ExecStart for ever.
  #
  # So: compare. Identical means the override is redundant and is removed;
  # different means this checkout is newer and the override is (re)written.
  if [[ -f "$SYSTEM_UNIT" ]] && cmp -s "$SYSTEM_UNIT" "$REPO_ROOT/packaging/$UNIT_NAME"; then
    if [[ -f "$USER_UNIT_DIR/$UNIT_NAME" ]]; then
      echo "The packaged unit is current; removing the redundant user-level copy:"
      echo "  $USER_UNIT_DIR/$UNIT_NAME"
      rm -f "$USER_UNIT_DIR/$UNIT_NAME"
    else
      echo "Using the packaged unit at $SYSTEM_UNIT"
    fi
  else
    echo "The packaged unit is missing or out of date; installing a user-level"
    echo "override, which takes precedence over $SYSTEM_UNIT:"
    echo "  $USER_UNIT_DIR/$UNIT_NAME"
    install -m 0644 "$REPO_ROOT/packaging/$UNIT_NAME" "$USER_UNIT_DIR/$UNIT_NAME"
  fi
else
  echo "No packaged install found, writing a development unit"
  if [[ ! -f "$REPO_ROOT/dist/daemon/index.js" ]]; then
    echo "error: $REPO_ROOT/dist/daemon/index.js is missing. Run 'pnpm run build' first." >&2
    exit 1
  fi
  # Must be Electron's Node, not the system one: better-sqlite3 is compiled
  # against Electron's ABI by the postinstall hook.
  ELECTRON_BIN="$REPO_ROOT/node_modules/electron/dist/electron"
  if [[ ! -x "$ELECTRON_BIN" ]]; then
    echo "error: $ELECTRON_BIN is missing. Run 'pnpm install' first." >&2
    exit 1
  fi
  cat >"$USER_UNIT_DIR/$UNIT_NAME" <<EOF
[Unit]
Description=GitHub Notifier background service (development checkout)
After=graphical-session.target network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=ELECTRON_RUN_AS_NODE=1
Environment=NODE_ENV=production
Environment=LOG_LEVEL=info
WorkingDirectory=$REPO_ROOT
ExecStart=$ELECTRON_BIN $REPO_ROOT/dist/daemon/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=github-notifier

[Install]
WantedBy=default.target
EOF
fi

# Desktop notifications and the keyring both need the session bus address to be
# visible to systemd --user.
systemctl --user import-environment DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR || true

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"

echo
systemctl --user --no-pager status "$UNIT_NAME" || true
echo
echo "Follow the log with:  journalctl --user -u github-notifier -f"

# Without lingering, the service stops when the last session closes.
if ! loginctl show-user "$USER" -p Linger --value 2>/dev/null | grep -q yes; then
  echo
  echo "Tip: to keep the service running when you are logged out, run:"
  echo "  sudo loginctl enable-linger $USER"
fi
