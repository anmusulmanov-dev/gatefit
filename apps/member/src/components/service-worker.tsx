'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (public/sw.js) that lets the app open without signal. Only
 * in production builds: in development it would serve stale pages over hot reloads.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}
