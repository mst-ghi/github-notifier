import type {
  AppNotification,
  AppSettings,
  AppSettingsUpdate,
  DaemonStatus,
  NotificationPage,
  NotificationQuery,
  NotificationStats,
  OpenPullRequestCounts,
  ProfileOverview,
  PullRequestDetail,
  PullRequestSummary,
  Repo,
  RepoUpdate,
  TokenValidation,
  UpdateInfo,
  WindowBounds,
} from './domain';

/**
 * Type-safe IPC contract.
 *
 * `IpcRequestMap` describes every renderer -> main call: the tuple is the
 * argument list, the second member is the resolved value. `IpcEventMap`
 * describes every main -> renderer push. Both the preload bridge and the main
 * process handler registry are derived from these maps, so adding a channel in
 * one place without the other is a compile error.
 */

export interface IpcRequestMap {
  /* --- settings --- */
  'settings:get': { args: []; result: AppSettings };
  'settings:update': { args: [update: AppSettingsUpdate]; result: AppSettings };
  /** Stores the token in the OS keyring. The token never touches the database. */
  'settings:setToken': { args: [token: string]; result: TokenValidation };
  'settings:clearToken': { args: []; result: null };
  'settings:validateToken': { args: []; result: TokenValidation };
  'settings:setWebhookSecret': { args: [secret: string]; result: null };
  /** Generates a random webhook secret, stores it, returns it once for display. */
  'settings:generateWebhookSecret': { args: []; result: string };

  /* --- repos --- */
  'repos:list': { args: []; result: Repo[] };
  /** Pulls the repo list from GitHub and upserts it. */
  'repos:sync': { args: []; result: Repo[] };
  'repos:update': { args: [repoId: string, update: RepoUpdate]; result: Repo };
  'repos:setMonitoring': { args: [repoId: string, enabled: boolean]; result: Repo };
  /** Creates or repairs the GitHub webhook for a repo. */
  'repos:installWebhook': { args: [repoId: string]; result: Repo };
  'repos:removeWebhook': { args: [repoId: string]; result: Repo };
  /** One repository by row id, for the detail page. */
  'repos:get': { args: [repoId: string]; result: Repo };
  /** Monitored repositories only. */
  'repos:listActive': { args: []; result: Repo[] };

  /* --- pull requests --- */
  'pulls:list': { args: [repoId: string]; result: PullRequestSummary[] };
  'pulls:get': { args: [repoId: string, number: number]; result: PullRequestDetail };
  /**
   * Detail by owner/repo/number, for pull requests found through search that
   * may live in a repository the app does not track locally.
   */
  'pulls:getByRef': {
    args: [owner: string, repo: string, number: number];
    result: PullRequestDetail;
  };
  /** Cached totals, refreshed only when older than a few minutes. */
  'pulls:counts': { args: []; result: OpenPullRequestCounts };
  'pulls:refreshCounts': { args: []; result: OpenPullRequestCounts };

  /* --- profile --- */
  'profile:overview': { args: []; result: ProfileOverview };

  /* --- notifications --- */
  'notifications:query': { args: [query: NotificationQuery]; result: NotificationPage };
  'notifications:get': { args: [id: string]; result: AppNotification | null };
  'notifications:markRead': { args: [ids: string[]]; result: number };
  'notifications:markAllRead': { args: []; result: number };
  'notifications:delete': { args: [ids: string[]]; result: number };
  'notifications:clearAll': { args: []; result: number };
  'notifications:unreadCount': { args: []; result: number };
  /** Distinct repo names present in the history, for the filter dropdown. */
  'notifications:repoFacets': { args: []; result: string[] };
  /** Counts and file size, for the housekeeping section in Settings. */
  'notifications:stats': { args: []; result: NotificationStats };
  /**
   * Deletes everything older than `days`, read or not. Omit `days` to use the
   * configured retention. Returns how many rows went.
   */
  'notifications:pruneNow': { args: [days?: number]; result: number };

  /* --- daemon control --- */
  'daemon:status': { args: []; result: DaemonStatus };
  'daemon:pause': { args: []; result: DaemonStatus };
  'daemon:resume': { args: []; result: DaemonStatus };
  'daemon:pollNow': { args: []; result: DaemonStatus };
  'daemon:reloadSettings': { args: []; result: DaemonStatus };

  /* --- shell --- */
  'shell:openExternal': { args: [url: string]; result: null };
  'app:version': { args: []; result: string };
  /** Copies text to the system clipboard, for the setup commands. */
  'app:copyToClipboard': { args: [text: string]; result: null };
  /** Asks GitHub whether a newer release exists. Never installs anything. */
  'app:checkForUpdates': { args: []; result: UpdateInfo };
  /**
   * Whether *this window's* database handle is open.
   *
   * Deliberately separate from `DaemonStatus.dbConnected`: the window opens the
   * file itself, so "the daemon is not running" must never be reported as
   * "the database is down".
   */
  'app:dbConnected': { args: []; result: boolean };

  /* --- custom window frame --- */
  'window:minimizeToTray': { args: []; result: null };
  'window:minimize': { args: []; result: null };
  /** Toggles maximise and returns the state afterwards. */
  'window:toggleMaximize': { args: []; result: boolean };
  'window:close': { args: []; result: null };
  'window:isMaximized': { args: []; result: boolean };
  /** Used by the custom resize borders to compute the new rectangle. */
  'window:getBounds': { args: []; result: WindowBounds };
  'window:setBounds': { args: [bounds: WindowBounds]; result: null };
}

export type IpcChannel = keyof IpcRequestMap;
export type IpcArgs<C extends IpcChannel> = IpcRequestMap[C]['args'];
export type IpcResult<C extends IpcChannel> = IpcRequestMap[C]['result'];

/** Main -> renderer push channels. */
export interface IpcEventMap {
  'event:notification': AppNotification;
  'event:unreadCount': number;
  'event:status': DaemonStatus;
  'event:reposChanged': Repo[];
  /** Pushed when the open pull-request totals change. */
  'event:pullCounts': OpenPullRequestCounts;
  'event:navigate': { route: '/' | '/notifications' | '/settings' };
  /** Pushed whenever the window is maximised or restored. */
  'event:maximizeChanged': boolean;
  /** This window's own database connection state. */
  'event:dbConnected': boolean;
  'event:toast': { severity: 'info' | 'success' | 'warning' | 'error'; message: string };
}

export type IpcEventChannel = keyof IpcEventMap;
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventMap[C];

/**
 * Envelope every `invoke` resolves to. Errors are transported as data instead
 * of thrown Electron errors so the renderer gets a real message, not
 * `Error invoking remote method ...`.
 */
export type IpcResponse<T> = { ok: true; data: T } | { ok: false; error: IpcErrorPayload };

export interface IpcErrorPayload {
  message: string;
  code: IpcErrorCode;
  /** Only populated in development builds. */
  stack?: string;
}

export type IpcErrorCode =
  | 'UNKNOWN'
  | 'NO_TOKEN'
  | 'BAD_TOKEN'
  | 'MISSING_SCOPE'
  | 'DB_UNAVAILABLE'
  | 'DAEMON_UNREACHABLE'
  | 'GITHUB_ERROR'
  | 'RATE_LIMITED'
  | 'VALIDATION'
  | 'NOT_FOUND';

/** Shape exposed on `window.api` by the preload script. */
export interface RendererApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>>;
  on<C extends IpcEventChannel>(
    channel: C,
    listener: (payload: IpcEventPayload<C>) => void
  ): () => void;
  platform: NodeJS.Platform;
  isDev: boolean;
  /**
   * True when the app must draw its own resize borders.
   *
   * Native Wayland refuses to let a client position itself, so the fake
   * borders — which work by calling `setBounds` — cannot move the window's
   * top-left corner there. On X11, XWayland and Windows they work fine.
   */
  useCustomResize: boolean;
}
