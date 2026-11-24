'use client';

import { QR_REFRESH_SECONDS, type QrTokenDto } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

/** Where the latest codes are kept, so the QR still shows after a reload without signal. */
const STORAGE_KEY = 'gatefit.qr';

interface Code {
  token: string;
  /** Shown from this moment... */
  from: number;
  /** ...until this one, when it stops working. */
  until: number;
}

function codesOf(qr: QrTokenDto): Code[] {
  const refresh = new Date(qr.refreshAt).getTime();
  return [
    {
      token: qr.token,
      from: refresh - QR_REFRESH_SECONDS * 1000,
      until: new Date(qr.expiresAt).getTime(),
    },
    ...qr.upcoming.map((next) => ({
      token: next.token,
      from: new Date(next.validFrom).getTime(),
      until: new Date(next.expiresAt).getTime(),
    })),
  ];
}

function readStored(): Code[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Code[]) : [];
  } catch {
    return [];
  }
}

function store(codes: Code[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
  } catch {
    // Private mode or full storage: the code still shows while online.
  }
}

/** The newest code whose turn has come and that still works. */
function currentOf(codes: readonly Code[], now: number): Code | null {
  return codes.filter((code) => code.from <= now && now < code.until).at(-1) ?? null;
}

/**
 * The member's entry code (docs/TZ.md F-3.1, F-9.1): a new one every 30 seconds, fetched
 * with the next few, so the code keeps working for a couple of minutes without signal.
 */
export function QrCard() {
  const t = useTranslations('member.qr');
  const [codes, setCodes] = useState<Code[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [offline, setOffline] = useState(false);
  const [svg, setSvg] = useState<{ token: string; url: string } | null>(null);

  // Codes kept from last time first, then fresh ones, every 30 seconds.
  useEffect(() => {
    let cancelled = false;
    const fetchCodes = async () => {
      const result = await api.get<QrTokenDto>('/me/qr');
      if (cancelled) {
        return;
      }
      if (result.ok) {
        const fresh = codesOf(result.data);
        store(fresh);
        setCodes(fresh);
        setOffline(false);
      } else {
        setOffline(true);
        setCodes((current) => (current.length > 0 ? current : readStored()));
      }
    };
    const kept = setTimeout(() => {
      setCodes((current) => (current.length > 0 ? current : readStored()));
      void fetchCodes();
    }, 0);
    const refresh = setInterval(() => {
      void fetchCodes();
    }, QR_REFRESH_SECONDS * 1000);
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      cancelled = true;
      clearTimeout(kept);
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, []);

  const current = currentOf(codes, now);

  useEffect(() => {
    if (!current || svg?.token === current.token) {
      return;
    }
    let cancelled = false;
    void QRCode.toString(current.token, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(
      (markup) => {
        if (!cancelled) {
          setSvg({
            token: current.token,
            url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [current, svg?.token]);

  const secondsLeft = current
    ? Math.max(0, Math.ceil((current.from + QR_REFRESH_SECONDS * 1000 - now) / 1000))
    : 0;

  return (
    <section
      aria-labelledby="qr-title"
      className="gf-glass flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-card"
    >
      <h2 id="qr-title" className="text-lg font-bold">
        {t('title')}
      </h2>
      {current && svg?.token === current.token ? (
        // eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL
        <img
          src={svg.url}
          alt={t('alt')}
          className="aspect-square w-full max-w-72 animate-pop rounded-md bg-white p-2 shadow-card"
        />
      ) : (
        <div className="gf-skeleton flex aspect-square w-full max-w-72 items-center justify-center p-4 text-center text-sm text-muted-foreground">
          {codes.length === 0 && !offline ? t('loading') : t('noCode')}
        </div>
      )}
      {current && (
        <p className="text-sm text-muted-foreground" aria-live="off">
          {t('refreshIn', { seconds: secondsLeft })}
        </p>
      )}
      {offline && current && <p className="text-center text-sm text-warn-ink">{t('offline')}</p>}
      <p className="text-center text-sm text-muted-foreground">{t('hint')}</p>
    </section>
  );
}
