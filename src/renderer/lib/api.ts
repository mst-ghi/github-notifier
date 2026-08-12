import type {
  IpcArgs,
  IpcChannel,
  IpcEventChannel,
  IpcEventPayload,
  IpcResult,
  RendererApi,
} from '../../shared/types';

/**
 * Thin typed accessor for the preload bridge. Keeping the `window.api` lookup
 * in one place means the rest of the renderer never touches `window` directly.
 */

declare global {
  interface Window {
    api: RendererApi;
  }
}

function bridge(): RendererApi {
  if (typeof window === 'undefined' || !window.api) {
    throw new Error('The preload bridge is not available. Is this running inside Electron?');
  }
  return window.api;
}

export function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<IpcResult<C>> {
  return bridge().invoke(channel, ...args);
}

export function onEvent<C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEventPayload<C>) => void
): () => void {
  return bridge().on(channel, listener);
}

export function openExternal(url: string): void {
  void invoke('shell:openExternal', url);
}

export const isDev: boolean = typeof window !== 'undefined' && Boolean(window.api?.isDev);
