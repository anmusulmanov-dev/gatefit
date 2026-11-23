'use client';

import type { ApiError } from '@gatefit/shared';
import { useCallback, useEffect, useState } from 'react';

import { api } from './api';

/** Loads `path` from the API; `reload()` asks again. Keeps the last data while reloading. */
export function useApiGet<T>(path: string) {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; data: T | null; error: ApiError | null }>();
  const key = `${String(version)}:${path}`;

  useEffect(() => {
    let cancelled = false;
    void api.get<T>(path).then((result) => {
      if (!cancelled) {
        setLoaded(
          result.ok
            ? { key, data: result.data, error: null }
            : { key, data: null, error: result.error },
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key, path]);

  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  return {
    data: loaded?.data ?? null,
    error: loaded?.key === key ? loaded.error : null,
    loading: loaded?.key !== key,
    reload,
  };
}
