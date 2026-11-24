'use client';

import {
  type AccessResultDto,
  type ApiResult,
  type CheckInDto,
  ErrorCode,
  isUnreachable,
  localDate,
  type Page,
  startOfLocalDay,
} from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

import { FormMessage } from '@/components/form';
import { Empty, LoadFailed, Loading } from '@/components/page-states';
import { useCan } from '@/components/staff-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useApiAction, useApiGet } from '@/lib/use-api';

import type { MemberScope } from '../members/member-scope';
import { useMemberLocations } from '../members/member-ui';
import { CheckInBadge, useCheckInTime } from './access-ui';
import { CameraScanner } from './camera-scanner';
import { ManualEntryDialog } from './manual-entry-dialog';
import { ResultCard } from './result-card';
import { useAccessFeed } from './use-access-feed';
import { useOfflineAccess } from './use-offline-access';

/** A code the camera keeps seeing is checked once in this window. */
const SAME_CODE_MS = 5_000;
const RECENT_LIMIT = 20;

/**
 * The reception screen (docs/TZ.md F-3.2, F-3.3): a USB scanner types the code into the
 * focused field and presses Enter, or the camera reads it. The answer shows big, green or
 * red, with the member's photo; below are the latest entries, live, and the head count.
 */
export function ReceptionDesk({ scope }: { scope: MemberScope }) {
  const t = useTranslations('access');
  const canManual = useCan('access.manual');
  const locations = useMemberLocations(scope);
  const [locationId, setLocationId] = useState(scope.currentLocationId ?? '');
  const location =
    locations.data?.find((item) => item.id === locationId) ?? locations.data?.[0] ?? null;
  const feed = useAccessFeed(location?.id ?? null);
  const offline = useOfflineAccess(location?.id ?? null);
  const today = location ? localDate(new Date(), location.timezone) : null;
  const earlier = useApiGet<Page<CheckInDto>>(
    location && today
      ? `/check-ins?locationId=${location.id}&limit=${String(RECENT_LIMIT)}&from=${startOfLocalDay(today, location.timezone).toISOString()}`
      : null,
  );
  const verify = useApiAction();
  const exit = useApiAction();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<AccessResultDto | null>(null);
  /** The last result was decided by this screen, without the API. */
  const [decidedOffline, setDecidedOffline] = useState(false);
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState(false);
  const [leftIds, setLeftIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCode = useRef<{ code: string; at: number } | null>(null);

  const check = useCallback(
    (scanned: string) => {
      const token = scanned.trim();
      const now = Date.now();
      if (
        !token ||
        !location ||
        (lastCode.current?.code === token && now - lastCode.current.at < SAME_CODE_MS)
      ) {
        return;
      }
      lastCode.current = { code: token, at: now };
      let local = false;
      verify.run(
        async (): Promise<ApiResult<AccessResultDto>> => {
          if (!offline.offline) {
            const online = await api.post<AccessResultDto>('/access/verify', {
              token,
              locationId: location.id,
            });
            if (!isUnreachable(online)) {
              return online;
            }
            offline.wentOffline();
          }
          // No internet: decide here and queue the entry (acceptance criterion 11).
          local = true;
          const decided = await offline.verify(token);
          return decided
            ? { ok: true, data: decided }
            : {
                ok: false,
                status: 0,
                error: {
                  code: ErrorCode.INTERNAL_ERROR,
                  message: 'No offline data',
                  details: null,
                },
              };
        },
        (data) => {
          setResult(data);
          setDecidedOffline(local);
        },
        () => (local ? t('offline.noSnapshot') : undefined),
      );
    },
    [location, verify, offline, t],
  );

  // The scanner types into the field: keep it focused unless a dialog is open.
  useEffect(() => {
    if (!manual) {
      inputRef.current?.focus();
    }
  }, [manual, result, location]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      check(code);
      setCode('');
    }
  }

  const entries = [
    ...feed.entries,
    ...(earlier.data?.items ?? []).filter(
      (item) => !feed.entries.some((live) => live.id === item.id),
    ),
  ].slice(0, RECENT_LIMIT);

  if (locations.error) {
    return <LoadFailed onRetry={locations.reload} />;
  }
  if (!locations.data) {
    return <Loading />;
  }
  if (!location) {
    return <Empty>{t('noLocation')}</Empty>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
          {feed.occupancy !== null && (
            <Badge tone="brand">{t('occupancy', { count: feed.occupancy })}</Badge>
          )}
          {offline.offline ? (
            <Badge tone="warning">{t('offline.mode', { count: offline.queued })}</Badge>
          ) : (
            <>
              {!feed.connected && <Badge tone="muted">{t('offlineFeed')}</Badge>}
              {offline.queued > 0 && (
                <Badge tone="muted">{t('offline.sending', { count: offline.queued })}</Badge>
              )}
            </>
          )}
        </div>
        {locations.data.length > 1 && (
          <Select
            aria-label={t('location')}
            className="w-48"
            value={location.id}
            onChange={(event) => {
              setLocationId(event.target.value);
              setResult(null);
            }}
          >
            {locations.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <label htmlFor="scan-code" className="text-sm font-medium">
            {t('scanLabel')}
          </label>
          <Input
            id="scan-code"
            ref={inputRef}
            value={code}
            autoComplete="off"
            placeholder={t('scanPlaceholder')}
            className="h-12 text-lg"
            onChange={(event) => {
              setCode(event.target.value);
            }}
            onKeyDown={onKeyDown}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCamera((value) => !value);
              }}
            >
              {camera ? t('camera.stop') : t('camera.start')}
            </Button>
            {canManual && (
              <Button
                variant="outline"
                onClick={() => {
                  setManual(true);
                }}
              >
                {t('manual.action')}
              </Button>
            )}
          </div>
          {camera && <CameraScanner onCode={check} />}
          <FormMessage error={verify.error} />
        </div>
        <ResultCard result={result} pending={verify.pending} offline={decidedOffline} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="recent-title">
        <h2 id="recent-title" className="text-lg font-semibold">
          {t('recent')}
        </h2>
        <FormMessage error={exit.error} />
        {earlier.error ? (
          <LoadFailed onRetry={earlier.reload} />
        ) : !earlier.data ? (
          <Loading />
        ) : entries.length === 0 ? (
          <Empty>{t('noEntries')}</Empty>
        ) : (
          <RecentEntries
            entries={entries}
            canExit={canManual}
            leftIds={leftIds}
            pending={exit.pending}
            onExit={(entry) => {
              exit.run(
                () =>
                  api.post('/access/exit', { memberId: entry.member.id, locationId: location.id }),
                () => {
                  setLeftIds((ids) => [...ids, entry.id]);
                },
              );
            }}
          />
        )}
      </section>

      {manual && (
        <ManualEntryDialog
          locationId={location.id}
          onClose={() => {
            setManual(false);
          }}
          onDone={(done) => {
            setManual(false);
            setResult(done);
          }}
        />
      )}
    </div>
  );
}

function RecentEntries({
  entries,
  canExit,
  leftIds,
  pending,
  onExit,
}: {
  entries: CheckInDto[];
  canExit: boolean;
  leftIds: string[];
  pending: boolean;
  onExit: (entry: CheckInDto) => void;
}) {
  const t = useTranslations('access');
  const time = useCheckInTime();
  // Only a member's latest allowed movement offers "left": a refused scan after it does not
  // mean they went out.
  const latest = new Set<string>();
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.result === 'allowed' && !seen.has(entry.member.id)) {
      seen.add(entry.member.id);
      latest.add(entry.id);
    }
  }
  return (
    <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card [&>li]:transition-colors [&>li:hover]:bg-muted/50">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex animate-rise flex-wrap items-center justify-between gap-3 px-4 py-2"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="w-12 text-muted-foreground tabular-nums">{time(entry)}</span>
            <span className="font-medium">
              {entry.member.lastName} {entry.member.firstName}
            </span>
            <CheckInBadge checkIn={entry} />
            {entry.method === 'manual' && entry.direction === 'in' && (
              <span className="text-muted-foreground">{t('methods.manual')}</span>
            )}
          </div>
          {canExit &&
            latest.has(entry.id) &&
            entry.result === 'allowed' &&
            entry.direction === 'in' &&
            !leftIds.includes(entry.id) && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  onExit(entry);
                }}
              >
                {t('exit')}
              </Button>
            )}
        </li>
      ))}
    </ul>
  );
}
