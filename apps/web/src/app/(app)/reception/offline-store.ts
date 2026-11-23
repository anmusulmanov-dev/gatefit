'use client';

import type { OfflineCheckIn, OfflineSnapshotDto } from '@gatefit/shared';

// What a reception screen keeps in the browser to work offline (docs/TZ.md acceptance
// criterion 11): the latest snapshot per location and the entries waiting to be sent.
// IndexedDB survives a reload or a browser restart while the internet is down.

const DB_NAME = 'gatefit-access';
const DB_VERSION = 1;
const SNAPSHOTS = 'snapshots';
const QUEUE = 'queue';

export interface QueuedCheckIn {
  locationId: string;
  entry: OfflineCheckIn;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) {
        db.createObjectStore(SNAPSHOTS);
      }
      if (!db.objectStoreNames.contains(QUEUE)) {
        db.createObjectStore(QUEUE, { keyPath: 'entry.id' });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      opening = null;
      reject(request.error ?? new Error('IndexedDB is not available'));
    };
  });
  return opening;
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (objects: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = work(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

export const offlineStore = {
  saveSnapshot(snapshot: OfflineSnapshotDto): Promise<IDBValidKey> {
    return run(SNAPSHOTS, 'readwrite', (objects) => objects.put(snapshot, snapshot.location.id));
  },

  async snapshot(locationId: string): Promise<OfflineSnapshotDto | null> {
    const found = await run(
      SNAPSHOTS,
      'readonly',
      (objects) => objects.get(locationId) as IDBRequest<OfflineSnapshotDto | undefined>,
    );
    return found ?? null;
  },

  enqueue(locationId: string, entry: OfflineCheckIn): Promise<IDBValidKey> {
    return run(QUEUE, 'readwrite', (objects) => objects.put({ locationId, entry }));
  },

  async queued(locationId?: string): Promise<QueuedCheckIn[]> {
    const all = await run(
      QUEUE,
      'readonly',
      (objects) => objects.getAll() as IDBRequest<QueuedCheckIn[]>,
    );
    return locationId ? all.filter((item) => item.locationId === locationId) : all;
  },

  async remove(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      await run(QUEUE, 'readwrite', (objects) => objects.delete(id));
    }
  },
};
