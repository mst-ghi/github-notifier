import { useCallback, useEffect, useRef, useState } from 'react';
import type { IpcEventChannel, IpcEventPayload } from '../../shared/types';
import { onEvent } from '../lib/api';

/** Result of `useAsync`. `reload` re-runs the loader without clearing data. */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setData: (value: T) => void;
}

/**
 * Runs an async loader and tracks its state.
 *
 * `deps` behaves like `useEffect` deps. A load that finishes after the
 * component unmounted, or after a newer load started, is discarded so a slow
 * response can never overwrite a fresh one.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = []
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const runId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    const id = ++runId.current;
    setLoading(true);
    try {
      const result = await loaderRef.current();
      if (mounted.current && id === runId.current) {
        setData(result);
        setError(null);
      }
    } catch (caught) {
      if (mounted.current && id === runId.current) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      if (mounted.current && id === runId.current) {
        setLoading(false);
      }
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are supplied by the caller
  useEffect(() => {
    void run();
  }, deps);

  return { data, loading, error, reload: run, setData };
}

/** Subscribes to a main-process push for the lifetime of the component. */
export function useIpcEvent<C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEventPayload<C>) => void
): void {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    return onEvent(channel, (payload) => listenerRef.current(payload));
  }, [channel]);
}

/** Debounces a fast-changing value, e.g. a search box. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
