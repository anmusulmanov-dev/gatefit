'use client';

import type { ApiError } from '@gatefit/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api';

interface Options {
  /**
   * Ask again this often while the page is visible, and whenever it becomes visible again,
   * for data that changes behind the member's back (a visit spent at the front desk). These
   * refreshes are quiet: a failure keeps the last data instead of showing an error.
   */
  refreshEverySeconds?: number;
}

/** Loads `path` from the API; `reload()` asks again. Keeps the last data while reloading. */
export function useApiGet<T>(path: string, { refreshEverySeconds }: Options = {}) {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; data: T | null; error: ApiError | null }>();
  const key = `${String(version)}:${path}`;
  // Set while the next load is a background refresh rather than one the member asked for.
  const quiet = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const isQuiet = quiet.current;
    quiet.current = false;
    void api.get<T>(path).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setLoaded({ key, data: result.data, error: null });
      } else if (isQuiet) {
        setLoaded((previous) => (previous ? { ...previous, key } : previous));
      } else {
        setLoaded({ key, data: null, error: result.error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key, path]);

  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!refreshEverySeconds) return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      quiet.current = true;
      setVersion((current) => current + 1);
    };
    const timer = setInterval(refresh, refreshEverySeconds * 1000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refreshEverySeconds]);

  return {
    data: loaded?.data ?? null,
    error: loaded?.key === key ? loaded.error : null,
    loading: loaded?.key !== key,
    reload,
  };
}
