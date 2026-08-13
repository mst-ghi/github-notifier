# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.1] - 2026-08-13

### Fixed

- **The background service could not start from the .deb.** Its `ExecStart` was
  unquoted, and the install directory contains a space, so systemd tried to run
  `/opt/GitHub` and failed with `status=203/EXEC`. Both paths are quoted now.
- **A stale user-level unit silently shadowed the packaged one.** systemd
  prefers a unit in `~/.config/systemd/user` over `/usr/lib/systemd/user`, so an
  old development unit kept running the system Node against a `better-sqlite3`
  build made for Electron's ABI — a `NODE_MODULE_VERSION` mismatch, once every
  ten seconds, for ever. `install-service.sh` now compares the two units and
  either removes the redundant override or refreshes it.
- `StartLimitBurst` and `StartLimitIntervalSec` moved from `[Service]` to
  `[Unit]`, where systemd actually reads them.

## [2.0.0] - 2026-08-13

Second release. The storage engine changed, so this is a major version.

### Changed

- **SQLite replaces MongoDB.** The app now keeps everything in a single file at
  `~/.local/share/github-notifier/github-notifier.db`. There is no server to
  install, no credentials in the source, and the `.deb` no longer expects
  `mongod` to be running. WAL mode lets the daemon and the window use the file
  at the same time.
- **Notifications are kept for 7 days, not 90**, and pruning no longer spares
  unread entries. A three-week-old unread notification is not something anyone
  is going to act on.
- The daemon runs on Electron's bundled Node in every environment, so the
  native SQLite module only ever has to match one ABI.
- `DaemonStatus.mongoConnected` is now `dbConnected`.
- The sidebar no longer shows a database row. With a local file it would have
  been permanently green; a real failure still raises a banner on the
  Repositories page.

### Added

- **Notification details drawer.** Clicking a notification opens a panel from
  the right with the full record: pull request, actor, severity, whether the
  desktop toast was shown, the link, and the dedupe key.
- **Tray icon badge.** A red dot appears on the tray icon while anything is
  unread, for the many Linux trays that ignore `setTitle`.
- **Manual clean-up.** "Delete old" on the Notifications page and in Settings,
  plus a "Clear history" button, a live count of what would be deleted, and the
  database file size.
- **Release automation.** Pushing a `vX.Y.Z` tag builds the `.deb` and
  AppImage, generates `SHA256SUMS.txt`, and publishes them as a GitHub release.
  `pnpm run release:patch|minor|major` handles the version bump and tag.
- **Update check** in Settings, which reports a newer release and links to the
  `.deb`. It never installs anything by itself.

### Fixed

- **The close button did nothing.** The custom resize handles were sized with
  bare numbers, which Chakra resolves against its spacing scale, so a 12px
  corner handle became 48px and sat on top of the window controls. Real clicks
  hit the invisible handle instead of the button. Handles now use explicit
  pixel units and the titlebar sits above them.

## [1.0.0] - 2026-08-12

First release.

### Added

- Electron + React + TypeScript desktop app for GitHub pull-request activity.
- Headless background daemon under systemd, so notifications keep arriving with
  the window closed.
- Webhook receiver on port 8014 with HMAC-SHA256 signature verification.
- Polling engine covering comments, merges, reviews, CI status, and merge
  conflicts — the last of which has no webhook event and can only be polled.
- Desktop notifications through `notify-send`, clickable straight to the PR.
- Repository list with per-repo monitoring switches and event filters.
- Token stored in the libsecret keyring, with an encrypted-file fallback.
- Custom frameless window with rounded corners, drag region, window controls
  and resize borders.
- `.deb` packaging, Biome for lint and format, strict TypeScript throughout.

[Unreleased]: https://github.com/mst-ghi/github-notifier/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/mst-ghi/github-notifier/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/mst-ghi/github-notifier/releases/tag/v1.0.0
