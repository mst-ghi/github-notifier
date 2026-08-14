# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.2.0] - 2026-08-14

### Added

- **In-app update downloader.** The About tab downloads the new package itself,
  with a progress bar, percentage, `31.9 MB of 76.0 MB · 3.3 MB/s` and a cancel
  button. A compact chip appears in the header while it runs and turns green
  when the file is ready. The bytes are hashed and compared against the
  release's published `SHA256SUMS.txt`; a mismatch deletes the file. It saves
  and stops there — installing a .deb needs root, so the app hands over a
  verified file and the one command rather than running anything itself.
- **Settings are grouped into five tabs** — Account, Notifications, Service,
  History, About — instead of one long column.

### Changed

- The profile moved out of the sidebar: the avatar now sits in the header next
  to the colour-mode toggle, and opens the profile page.
- Notifications are no longer raised for pull requests that are already merged
  or closed. Finished work is a remark, not a task. The state is looked up once
  per pull request and cached for half an hour.

### Fixed

- **The poller lost every notification that existed before setup.** Its cursor
  advanced to "now" on each tick even when nothing was recorded, so the first
  run — which happens before any repository is being watched — skipped past all
  existing activity for ever. The cursor now moves only as far as the newest
  thread actually processed, and only once the batch has succeeded. Enabling a
  repository rewinds it so the repo reports its backlog immediately.
- **Comments were labelled "Assigned to you".** GitHub's `reason` says why you
  are subscribed to a thread, not what happened in it, so a comment on a pull
  request you were assigned kept `reason: assign`. Events are now classified
  from `latest_comment_url`: conversation comments, review comments on the diff
  and everything else are told apart correctly.
- `onlyMyPullRequests` applies to the poller as well as to webhooks. The two
  sources disagreed about what counted.
- **A single search request could stall every other GitHub call.** The
  rate-limit queue kept one quota with a fixed reserve of 100, sized for the
  core budget of 5000; search reports a budget of 30, so a normal search looked
  nearly exhausted and parked the queue until the reset. Quotas are tracked per
  resource now, and the reserve scales to each budget.
- **The window looked square despite its border radius.** Chakra's reset paints
  a background on `html`, which filled the corner notches behind the rounded
  shell. All three layers above the shell are transparent now.
- Removed a `box-shadow` that could never render: the shell fills the window, so
  the shadow fell entirely outside it and was clipped. The drop shadow comes
  from the compositor.

## [2.1.0] - 2026-08-14

### Added

- **Repository pages.** Watched repositories now appear in their own "Active"
  section, and opening one shows its details with every open pull request.
- **Pull-request drawer.** Clicking a pull request opens a panel from the right
  with the description, mergeable state, diff size, commits, comment counts and
  head commit. Labels render in their real GitHub colours.
- **Open pull-request counts** per repository and as a total in the sidebar.
  Counting reads the `Link` header's last-page number, so it costs one request
  per repository however many pull requests there are, and the result is cached
  in the database so the total paints instantly on launch.
- **First-run setup.** Three steps — connect an account, choose repositories,
  start the service — drawn as a chain that mirrors the app's real architecture
  and lights up from live state rather than from a "next" click, so it cannot
  claim something works when it does not.
- **Profile page.** Your account, token scopes and API quota, plus your open
  pull requests and the ones waiting on your review. Both lists come from the
  search API, so they span every repository the token can see rather than only
  the watched ones.
- **Version in the sidebar**, which also flags a mismatch when the window and
  the background service are running different builds — they are separate
  programs and are updated separately.

### Changed

- **Dark mode is matte black.** The palette was navy-tinted (chroma ~10); it is
  now neutral (chroma 1–2), never pure black, with each surface a few percent
  lighter than the last so the elevation steps stay readable.
- Headings use a monospaced display face. This tool lives beside a terminal and
  its own vocabulary is already monospaced.
- The window chrome moved into a shared `WindowFrame`, so setup and the main
  app cannot drift apart.

### Fixed

- **One search request could stall every other GitHub call.** The rate-limit
  queue kept a single quota and a fixed reserve of 100, sized for the core
  budget of 5000. GitHub's search endpoint reports a budget of 30, so a normal
  search looked like an almost-exhausted quota and parked the queue until the
  reset. Quotas are now tracked per resource, the reserve scales to each budget,
  and the figure shown to the user is the core one.
- Ligatures are off in code and commands: Fira Code rendered `--user` as a
  single long dash, which reads as an em-dash in a command you have to type.
- A second app instance no longer opens a database handle on its way out.

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
