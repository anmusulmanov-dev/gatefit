'use client';

import {
  type AccessResultDto,
  type AccessSyncResultDto,
  decideOffline,
  isUnreachable,
  OFFLINE_SYNC_MAX,
  OFFLINE_SYNC_MAX_AGE_HOURS,
  type OfflineSnapshotDto,
} from '@gatefit/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';

import { offlineStore } from './offline-store';

/** How often the screen refreshes what it needs to work offline. */
const SNAPSHOT_EVERY_MS = 5 * 60 * 1000;
/** How often waiting entries are retried. */
const SYNC_EVERY_MS = 30 * 1000;

export interface OfflineAccess {
  /** True while the API cannot be reached and the screen decides on its own. */
  offline: boolean;
  /** Entries waiting to be sent. */
  queued: number;
  /** When the kept member list was taken; null if there is none for this location. */
  snapshotAt: string | null;
  /** Decides on a code with no internet; null when there is no snapshot to decide with. */
  verify: (token: string) => Promise<AccessResultDto | null>;
  /** Marks the API unreachable (a request just failed for want of a network). */
  wentOffline: () => void;
}

/**
 * Keeps a reception screen able to let members in when the internet drops (docs/TZ.md
 * acceptance criterion 11): a fresh copy of the members and the public key in IndexedDB,
 * a local decision, and a queue that is sent once the API answers again.
 */
export function useOfflineAccess(locationId: string | null): OfflineAccess {
  const [offline, setOffline] = useState(false);
  const [queued, setQueued] = useState(0);
  const [snapshot, setSnapshot] = useState<OfflineSnapshotDto | null>(null);
  const syncing = useRef(false);

  const countQueue = useCallback(async () => {
    setQueued((await offlineStore.queued()).length);
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!locationId) {
      return;
    }
    const result = await api.get<OfflineSnapshotDto>(`/access/offline?locationId=${locationId}`);
    if (result.ok) {
      await offlineStore.saveSnapshot(result.data);
      setSnapshot(result.data);
      setOffline(false);
    } else if (isUnreachable(result)) {
      setOffline(true);
    }
  }, [locationId]);

  const sync = useCallback(async () => {
    if (syncing.current) {
      return;
    }
    syncing.current = true;
    try {
      const oldest = Date.now() - OFFLINE_SYNC_MAX_AGE_HOURS * 60 * 60 * 1000;
      const all = await offlineStore.queued();
      // Entries the API would no longer accept would block the queue for good.
      const stale = all.filter((item) => new Date(item.entry.at).getTime() < oldest);
      await offlineStore.remove(stale.map((item) => item.entry.id));
      const byLocation = new Map<string, typeof all>();
      for (const item of all) {
        if (!stale.includes(item)) {
          byLocation.set(item.locationId, [...(byLocation.get(item.locationId) ?? []), item]);
        }
      }
      for (const [location, items] of byLocation) {
        for (let start = 0; start < items.length; start += OFFLINE_SYNC_MAX) {
          const batch = items.slice(start, start + OFFLINE_SYNC_MAX);
          const result = await api.post<AccessSyncResultDto>('/access/sync', {
            locationId: location,
            checkIns: batch.map((item) => item.entry),
          });
          if (result.ok) {
            await offlineStore.remove(batch.map((item) => item.entry.id));
            setOffline(false);
          } else {
            if (isUnreachable(result)) {
              setOffline(true);
            }
            return;
          }
        }
      }
    } finally {
      syncing.current = false;
      await countQueue();
    }
  }, [countQueue]);

  // Load what was kept, then refresh it and send what waits; repeat in the background.
  useEffect(() => {
    if (!locationId) {
      return;
    }
    let cancelled = false;
    void offlineStore.snapshot(locationId).then((kept) => {
      if (!cancelled && kept) {
        setSnapshot((current) => current ?? kept);
      }
    });
    void offlineStore.queued().then((all) => {
      if (!cancelled) {
        setQueued(all.length);
      }
    });
    // Started from a timer rather than the effect body: the refresh ends in state updates.
    const first = setTimeout(() => {
      void refreshSnapshot().then(sync);
    }, 0);
    const snapshots = setInterval(() => {
      void refreshSnapshot();
    }, SNAPSHOT_EVERY_MS);
    const retries = setInterval(() => {
      void sync();
    }, SYNC_EVERY_MS);
    const online = () => {
      void refreshSnapshot().then(sync);
    };
    const lost = () => {
      setOffline(true);
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', lost);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(snapshots);
      clearInterval(retries);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', lost);
    };
  }, [locationId, refreshSnapshot, sync]);

  const verify = useCallback(
    async (token: string) => {
      const kept =
        snapshot?.location.id === locationId
          ? snapshot
          : locationId
            ? await offlineStore.snapshot(locationId)
            : null;
      if (!kept || !locationId) {
        return null;
      }
      const waiting = (await offlineStore.queued(locationId)).map((item) => item.entry);
      const decision = await decideOffline(kept, token, waiting, new Date());
      if (decision.checkIn) {
        await offlineStore.enqueue(locationId, decision.checkIn);
        await countQueue();
      }
      return decision.result;
    },
    [snapshot, locationId, countQueue],
  );

  const wentOffline = useCallback(() => {
    setOffline(true);
  }, []);

  return {
    offline,
    queued,
    snapshotAt: snapshot?.location.id === locationId ? snapshot.generatedAt : null,
    verify,
    wentOffline,
  };
}
