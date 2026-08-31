import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get } from './client';

export interface Resource<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** True only on the first load, so refetches do not blank the screen. */
  initial: boolean;
  reload: () => void;
}

/**
 * Minimal data hook: fetch on mount, refetch when `path` or `version` changes,
 * abort in flight requests on unmount so a fast navigation cannot write state
 * into an unmounted component.
 */
export function useResource<T>(path: string | null, deps: unknown[] = []): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [nonce, setNonce] = useState(0);
  const seen = useRef(false);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!path) {
      setData(undefined);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    get<T>(path, controller.signal)
      .then((result) => {
        setData(result);
        setError(null);
        seen.current = true;
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : 'Could not reach the server');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  return { data, error, loading, initial: loading && !seen.current, reload };
}
