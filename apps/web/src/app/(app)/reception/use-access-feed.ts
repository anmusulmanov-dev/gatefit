'use client';

import type { AccessEventDto, CheckInDto, OccupancyDto } from '@gatefit/shared';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

/** Wait before reconnecting a dropped feed. */
const RETRY_MS = 3_000;

interface FeedState {
  locationId: string | null;
  occupancy: number | null;
  entries: CheckInDto[];
  connected: boolean;
}

const emptyFeed = (locationId: string | null): FeedState => ({
  locationId,
  occupancy: null,
  entries: [],
  connected: false,
});

/**
 * The live feed of a location (server-sent events): new entries as they happen and the
 * head count. A dropped feed reconnects; an expired session is refreshed first by an
 * ordinary request, which the API client handles.
 */
export function useAccessFeed(locationId: string | null): FeedState {
  const [state, setState] = useState<FeedState>(emptyFeed(null));

  useEffect(() => {
    if (!locationId) {
      return;
    }
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    /** Updates the state of this location, starting afresh if it held another one. */
    const update = (change: (current: FeedState) => Partial<FeedState>) => {
      setState((previous) => {
        const current = previous.locationId === locationId ? previous : emptyFeed(locationId);
        return { ...current, ...change(current) };
      });
    };

    const connect = () => {
      source = new EventSource(`/api/v1/access/events?locationId=${locationId}`);
      source.addEventListener('open', () => {
        update(() => ({ connected: true }));
      });
      source.addEventListener('occupancy', (event) => {
        const occupancy = JSON.parse((event as MessageEvent<string>).data) as OccupancyDto;
        update(() => ({ occupancy: occupancy.count }));
      });
      source.addEventListener('check-in', (event) => {
        const data = JSON.parse((event as MessageEvent<string>).data) as AccessEventDto;
        update((current) => ({
          occupancy: data.occupancy.count,
          entries: [data.checkIn, ...current.entries.filter((item) => item.id !== data.checkIn.id)],
        }));
      });
      source.addEventListener('error', () => {
        source?.close();
        update(() => ({ connected: false }));
        if (closed) {
          return;
        }
        retry = setTimeout(() => {
          // Refreshes the session if it expired, then listens again.
          void api.get(`/locations/${locationId}/occupancy`).then(() => {
            if (!closed) {
              connect();
            }
          });
        }, RETRY_MS);
      });
    };

    connect();
    return () => {
      closed = true;
      if (retry) {
        clearTimeout(retry);
      }
      source?.close();
    };
  }, [locationId]);

  return state.locationId === locationId ? state : emptyFeed(locationId);
}
