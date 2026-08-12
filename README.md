# GitHub Notifier

Desktop notifier for GitHub pull requests, for Debian 13. Electron + React + TypeScript
(strict), a headless background service under systemd, MongoDB history, and native desktop
notifications you can click to jump straight to the pull request.

---

## What it watches

| Event | How it is detected |
| --- | --- |
| Someone comments on your PR | webhook `issue_comment` / `pull_request_review_comment`, or polling |
| Your PR was merged or closed | webhook `pull_request` (action `closed`), or polling |
| Your PR has merge conflicts | **polling only** — see the note below |
| Conflicts got fixed | polling |
| CI checks passed or failed | webhook `check_suite` (off by default per repo) |
| Assigned to you / review requested | webhook `pull_request`, or polling |

### Two important design notes

**1. GitHub cannot reach `localhost:8014`.** A webhook is GitHub making an HTTP request *to
you*. On a normal desktop behind NAT, that request never arrives. So this app has two
sources of events:

- the **webhook receiver** on port 8014, used when you expose it (tunnel or public address);
- the **poller**, which asks GitHub for news and needs no network setup at all.

You can run with polling only. That is the default and it works out of the box.

**2. There is no GitHub event for "this PR now has conflicts."** A conflict appears when
somebody else merges into the base branch — nothing happens on your PR at all. The only way
to find out is to ask GitHub for the pull request and read its `mergeable` field. That is
what the conflict scan does, on a slower timer, and only for PRs older than a grace period.

---

## Architecture

```
┌──────────────────────────────┐         ┌────────────────────────────────┐
│  daemon  (systemd user unit) │         │  Electron app (the window)     │
│                              │         │                                │
│  webhook receiver  :8014     │         │  main process ── IPC ── React  │
│  poller (notifications API)  │         │       │                        │
│  conflict scanner            │         │       └── reads/writes Mongo   │
│  desktop notifications       │         │                                │
│  control API  127.0.0.1:8015 │◄────────┤  control client (bearer token) │
└──────────────┬───────────────┘         └────────────────┬───────────────┘
               │                                          │
               └────────────► MongoDB  ◄──────────────────┘
                              repos / notifications / settings
```

The split is the point: **closing the window changes nothing.** The daemon owns the webhook
listener, the poller and the toasts, so there is exactly one of each no matter how often you
open and close the app.

### Source layout

```
src/
  shared/            renderer-safe: no Node imports
    types/
      domain.ts      Repo, AppNotification, AppSettings, DaemonStatus…
      github.ts      webhook payload union, PullRequestSnapshot
      ipc.ts         the IPC contract — one map for calls, one for pushes
    constants.ts     ports, defaults, keyring names
    errors.ts        AppError with a machine-readable code
    format.ts        event labels, relative time, badge text
  core/              engine, shared by the daemon and Electron main
    database.ts      Mongoose connection with its own retry loop
    models/          repo / notification / settings schemas + DTO mappers
    github-api.ts    typed Octokit facade, every call queued
    rate-limit-queue.ts
    webhook-server.ts  Fastify + HMAC signature verification
    poller.ts        notifications poll + conflict scan
    event-processor.ts  payload -> notification, with filters and dedupe
    notification-service.ts  queries, search, retention
    repo-service.ts  repo sync and webhook registration
    notifier.ts      notify-send with a clickable action
    secrets.ts       libsecret keyring, encrypted-file fallback
    engine.ts        wires it all together
    control-server.ts / control-client.ts
  daemon/index.ts    what systemd runs
  main/              Electron main: window, tray, IPC handlers, preload
  renderer/          React 18 + Chakra UI v3
```

---

## Setup

### 1. Dependencies

```bash
sudo apt install -y mongodb-org libsecret-1-0 libnotify-bin imagemagick
```

`libsecret-1-0` backs the keyring where the token is stored. `libnotify-bin` provides
`notify-send`, which is what makes notifications clickable.

Node 20 or newer, and pnpm:

```bash
corepack enable && corepack prepare pnpm@latest --activate
```

### 2. MongoDB

The app connects to `mongodb://mostafa:Mostafa123@localhost:27017` with `authSource=admin`
and uses the database `github_notifier`.

```bash
sudo systemctl enable --now mongod
mongosh "mongodb://mostafa:Mostafa123@localhost:27017/?authSource=admin" --eval 'db.runCommand({ping:1})'
```

If that user does not exist yet:

```bash
mongosh --eval '
  db.getSiblingDB("admin").createUser({
    user: "mostafa",
    pwd: "Mostafa123",
    roles: [{ role: "readWriteAnyDatabase", db: "admin" }]
  })'
```

Override the connection without touching the code:

```bash
MONGO_URI="mongodb://user:pass@host:27017" MONGO_DB=github_notifier pnpm run start:daemon
```

Three collections are created automatically, with indexes:

- **`repos`** — one document per repository, plus `monitoring` and the per-event filters.
- **`notifications`** — `repoName`, `prNumber`, `eventType`, `message`, `url`, `createdAt`,
  `isRead`, `userId`, and a unique `dedupeKey` that stops the webhook and the poller from
  reporting the same thing twice.
- **`settings`** — one document. Never contains the token.

### 3. Install and build

```bash
pnpm install
pnpm run build
```

### 4. GitHub token

Create a classic personal access token with the **`repo`** and **`notifications`** scopes:

<https://github.com/settings/tokens/new?scopes=repo,notifications&description=GitHub%20Notifier>

Then open the app, go to **Settings**, paste it and press Save. The app validates it against
GitHub, tells you which scopes are missing, and stores it in your keyring — never in MongoDB
and never in a config file in plain text.

A fine-grained token also works, but it must grant *Pull requests: read*, *Contents: read*,
*Metadata: read*, and *Webhooks: read & write* if you want automatic webhook registration.

### 5. Start the background service

```bash
pnpm run service:install
```

That script detects whether you are running from a git checkout or from an installed `.deb`
and writes the right unit either way. Or do it by hand:

```bash
systemctl --user enable --now github-notifier
journalctl --user -u github-notifier -f
```

To keep it running while you are logged out:

```bash
sudo loginctl enable-linger $USER
```

---

## Daily use

Open the app, press **Sync from GitHub** on the Repositories page, then flip the switch on
each repository you care about. Expand a row to choose which events count for that repo.

The tray icon carries the unread count and gives you: open app, view notifications, mark all
read, pause/resume monitoring, check now, settings, quit.

Clicking a notification — in the list or the desktop toast — opens the pull request in your
browser and marks it read.

---

## Webhooks (optional)

Skip this whole section unless you want sub-minute latency. Polling covers every event type.

You need a public HTTPS address that forwards to port 8014. The easiest is a Cloudflare
tunnel:

```bash
cloudflared tunnel --url http://localhost:8014
```

Then in **Settings → Webhook receiver**:

1. Put the public address in **Public URL** (just the origin, e.g. `https://abc.trycloudflare.com`
   — the app appends `/webhook` itself).
2. Press **Generate new** to create the shared secret. It is stored in the keyring.
3. Back on Repositories, press the webhook button on any repo where you have **admin**
   permission. The app creates the hook through the GitHub API and subscribes it to
   `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issue_comment` and
   `check_suite`.

Every delivery is verified against `X-Hub-Signature-256` before it is parsed. A bad signature
gets a 401 and is logged with the source IP; unknown event types get a 202 and are ignored.

Check it end to end:

```bash
curl -s http://localhost:8014/health
```

---

## Custom window decorations

The window has no OS frame. It is created with `frame: false` and
`transparent: true`, and everything a title bar normally gives you is drawn by
the app. The approach follows
[Fruitsalad/electron-custom-window-example](https://github.com/Fruitsalad/electron-custom-window-example),
adapted to this codebase's typed IPC.

How the pieces fit:

- **Rounded corners.** `body` stays transparent — it cannot have a border radius
  on a transparent window — so [AppShell.tsx](src/renderer/components/AppShell.tsx)
  renders an inner box that carries the radius, border and shadow. The radius is
  dropped while maximised, where rounded corners against a screen edge just look
  like a bug.
- **Dragging.** The header carries `-webkit-app-region: drag`. A drag region
  swallows pointer events, so every button and input inside it is switched back
  to `no-drag` by [window-chrome.css](src/renderer/window-chrome.css).
  Double-clicking the header toggles maximise, as usual.
- **Window controls.** [WindowControls.tsx](src/renderer/components/WindowControls.tsx)
  draws minimise / maximise / close and calls the main process. The maximise icon
  follows `event:maximizeChanged`, which is pushed from
  [window.ts](src/main/window.ts) — so the icon stays right even when the window
  manager does the maximising via a keyboard shortcut.
- **Close means hide.** The close button hides to the tray instead of quitting,
  exactly like the old OS button did. Quit lives in the tray menu.
- **Resizing.** A frameless window has no grab handles, so
  [ResizeBorders.tsx](src/renderer/components/ResizeBorders.tsx) lays eight
  invisible strips around the edge and turns drags into `setBounds` calls. The
  arithmetic is in [drag-resize.ts](src/renderer/lib/drag-resize.ts): dragging a
  leading edge moves the origin *and* shrinks the size, dragging a trailing edge
  only grows it, and the origin is pinned once the minimum size is hit so the
  window cannot keep sliding.

### The Wayland caveat

The fake borders resize by setting the window's position. A **native Wayland**
client is not allowed to position itself, so dragging the top or left edge would
stretch the window from the wrong corner. The preload script detects that case
(`WAYLAND_DISPLAY` set, `DISPLAY` unset) and turns the custom borders off; the
flag reaches the renderer as `window.api.useCustomResize`.

Under XWayland — the default for Electron 33, and what this was tested on —
`setBounds` is honoured for both position and size, so the borders work normally.
If you launch with `--ozone-platform=wayland`, expect to resize from the window
manager instead.

## Build a .deb

```bash
pnpm run package:deb
sudo dpkg -i "release/github-notifier_1.0.0_amd64.deb"
sudo apt-get -f install     # only if dpkg reports missing dependencies
```

The package installs to `/opt/GitHub Notifier`, drops a systemd **user** unit in
`/usr/lib/systemd/user/github-notifier.service`, and installs the icon into the hicolor
theme. After installing:

```bash
systemctl --user enable --now github-notifier
```

The daemon runs on Electron's bundled Node (`ELECTRON_RUN_AS_NODE=1`), so the package does
not depend on a system `nodejs`.

Icons are generated from `logo.jpg`:

```bash
pnpm run icons
```

---

## Development

```bash
pnpm run dev          # vite + tsc --watch + electron, renderer hot-reloads
pnpm run dev:daemon   # daemon with --watch, in a second terminal
```

`pnpm run dev` starts three processes: Vite on port 5173, `tsc --watch` for everything
Node-side, and Electron pointed at the dev server. Renderer edits hot-reload; main-process
edits need an Electron restart.

| Command | What it does |
| --- | --- |
| `pnpm run build` | Compiles Node-side with tsc and the renderer with Vite |
| `pnpm run typecheck` | Both tsconfigs, no emit |
| `pnpm run lint` | Biome lint |
| `pnpm run lint:fix` | Biome lint with safe fixes |
| `pnpm run format` | Biome formatter |
| `pnpm run check` | Lint + format + import sorting in one pass |
| `pnpm run check:fix` | Same, applying safe fixes |
| `pnpm run package:deb` | Build and produce the `.deb` |
| `pnpm run service:install` | Install and start the user service |

### TypeScript notes

Three configs, because the two halves of the app target different runtimes:

- `tsconfig.json` — the shared base. Strict, plus `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitReturns` and `noFallthroughCasesInSwitch`.
- `tsconfig.node.json` — CommonJS for `shared/`, `core/`, `main/`, `daemon/`. This is what
  actually emits to `dist/`.
- `tsconfig.web.json` — ESNext + `bundler` resolution + `react-jsx` for the renderer.
  `noEmit`; Vite does the emitting.

There is no `any` anywhere in `src/`. Biome enforces it (`noExplicitAny: error`). Two places
need a cast and both are one line wide with a comment explaining why: the dynamic `require`
of the native keyring module, and the single `handlers[channel]` lookup in the IPC registry.

**The IPC contract is the interesting part.** `IpcRequestMap` in `src/shared/types/ipc.ts`
maps every channel to its argument tuple and its result type. The preload bridge, the
renderer's `invoke()` and the main process's handler table are all derived from that one map,
so adding a channel without a handler — or calling one with the wrong arguments — is a
compile error, not a runtime surprise.

### Biome notes

Biome replaces ESLint and Prettier. One config file, and it is fast enough to run on every
save. `pnpm run check` does linting, formatting and import sorting together.

Only a couple of things differ from a stock setup: `noExplicitAny` and `noUnusedVariables`
are raised to `error`, and `useKeyWithClickEvents` is switched off for the renderer, since
this is a desktop app where whole rows are clickable.

---

## Security

- **The token lives in the keyring** (libsecret, via `@napi-rs/keyring`). If no secret
  service is available — a minimal window manager, a headless box — it falls back to an
  AES-256-GCM file at `~/.config/github-notifier/secrets.enc.json`, mode `0600`, with the key
  derived from the machine id and user. The keyring is the better option; the fallback exists
  so the app still runs without one.
- **Webhook deliveries are verified** with HMAC-SHA256 over the raw request body, before the
  JSON is parsed.
- **The control API binds to 127.0.0.1 only** and requires a bearer token from
  `~/.config/github-notifier/control.token` (mode `0600`). Nothing on the network can reach it.
- **The renderer is sandboxed**: `contextIsolation` on, `nodeIntegration` off, a strict CSP,
  and the only bridge is the typed `window.api` object. External links always open in the
  real browser, never inside the app.
- Logs redact anything named `token`, `secret` or `authorization`.

---

## Troubleshooting

**No notifications appear at all**

```bash
systemctl --user status github-notifier
journalctl --user -u github-notifier -n 50
```

The Settings page also shows the service state. If it says "not running", the daemon is not
up and nothing is being watched.

**The service starts but no desktop toast appears**

The daemon needs the session bus. Check it:

```bash
systemctl --user show-environment | grep DBUS_SESSION_BUS_ADDRESS
systemctl --user import-environment DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR
systemctl --user restart github-notifier
notify-send "test" "if you can see this, libnotify works"
```

**Notifications appear but clicking does nothing**

Clickable actions need libnotify 0.8 or newer (`notify-send --version`). Debian 13 ships
0.8.x, so this should just work; on older systems the toast still appears but the click is
ignored, and you can open the item from the app's list instead.

**"MongoDB is not reachable"**

```bash
systemctl status mongod
mongosh "mongodb://mostafa:Mostafa123@localhost:27017/?authSource=admin" --eval 'db.runCommand({ping:1})'
```

The app reconnects on its own with exponential backoff, so once mongod is back nothing else
needs restarting.

**GitHub webhooks never arrive**

Almost always because GitHub cannot reach your machine. Confirm the receiver is up with
`curl -s http://localhost:8014/health`, then check the deliveries tab in the repository's
webhook settings on GitHub. A 401 there means the secret in the app and the secret on the
hook no longer match — regenerate it and press the webhook button on the repo again.

**"Admin permission is required to create a webhook"**

Expected on repositories you only contribute to. Leave that repo on polling; it still gets
every event.

**Rate limited**

The queue watches `x-ratelimit-remaining` and parks itself until the reset when fewer than
100 calls are left. If you hit it often, raise the conflict scan interval — that scan costs
one request per open pull request.

**Port 8014 or 8015 already in use**

Change them in Settings, or:

```bash
ss -lntp | grep -E '8014|8015'
```

**Two instances of the app**

Only one Electron window can run at a time; launching a second focuses the first. Two
*daemons* would be a real problem, so start it only through systemd.

---

## License

MIT
