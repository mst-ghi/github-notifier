import { contextBridge, ipcRenderer } from 'electron';
import type {
  IpcArgs,
  IpcChannel,
  IpcEventChannel,
  IpcEventPayload,
  IpcResponse,
  IpcResult,
  RendererApi,
} from '../shared/types';

/**
 * The only bridge between the renderer and Node.
 *
 * `contextIsolation` is on and `nodeIntegration` is off, so the renderer sees
 * exactly this object and nothing else. Errors travel as data and are re-thrown
 * here, which keeps `try/catch` in React components meaningful.
 */

class IpcError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
  }
}

const api: RendererApi = {
  async invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
    const response = (await ipcRenderer.invoke(channel, ...args)) as IpcResponse<IpcResult<C>>;
    if (response.ok) {
      return response.data;
    }
    throw new IpcError(response.error.message, response.error.code);
  },

  on<C extends IpcEventChannel>(
    channel: C,
    listener: (payload: IpcEventPayload<C>) => void
  ): () => void {
    const handler = (_event: Electron.IpcRendererEvent, payload: IpcEventPayload<C>): void => {
      listener(payload);
    };
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  platform: process.platform,
  isDev: process.env.NODE_ENV === 'development',
  useCustomResize: detectCustomResizeNeed(),
};

/**
 * Native Wayland does not let a client set its own position, so the fake resize
 * borders cannot drag the top or left edge there — the window would stretch
 * from the wrong corner. Under XWayland `DISPLAY` is set and `setBounds` works,
 * so only a session with Wayland but no X display is excluded.
 */
function detectCustomResizeNeed(): boolean {
  if (process.platform !== 'linux') {
    return true;
  }
  const nativeWayland = Boolean(process.env.WAYLAND_DISPLAY) && !process.env.DISPLAY;
  return !nativeWayland;
}

contextBridge.exposeInMainWorld('api', api);
