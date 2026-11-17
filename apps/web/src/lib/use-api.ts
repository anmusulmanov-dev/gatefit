'use client';

import { errorMessageKey } from '@gatefit/i18n/config';
import type { ApiError, ApiResult } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { api } from './api';

interface Loaded<T> {
  key: string;
  data: T | null;
  error: ApiError | null;
}

/**
 * Loads `path` from the API and reloads it on demand. While a reload runs, the previous
 * data stays on screen so lists do not flicker.
 */
export function useApiGet<T>(path: string) {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
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

/**
 * Runs a change against the API and turns a failure into a translated message. Also
 * accepts a client-side validation failure, reported with `fail()`.
 */
export function useApiAction() {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    <T>(
      request: () => Promise<ApiResult<T>>,
      onSuccess?: (data: T) => void,
      /** A message better suited to this form than the standard one, or undefined. */
      messageFor?: (error: ApiError) => string | undefined,
    ) => {
      setError(null);
      startTransition(async () => {
        const result = await request();
        if (result.ok) {
          onSuccess?.(result.data);
        } else {
          setError(messageFor?.(result.error) ?? t(errorMessageKey(result.error.code)));
        }
      });
    },
    [t],
  );

  const fail = useCallback(
    (message?: string) => {
      setError(message ?? t('errors.VALIDATION_FAILED'));
    },
    [t],
  );

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return { run, fail, reset, pending, error };
}
