'use client';

import jsQR from 'jsqr';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/** How often a frame is read; enough for a code held up to the camera. */
const SCAN_INTERVAL_MS = 250;

/**
 * Reads QR codes from a camera (docs/TZ.md F-3.2). Chrome on Windows has no built-in
 * barcode reader, so frames are decoded with jsQR. Stops the camera when unmounted.
 */
export function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const t = useTranslations('access.camera');
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const [error, setError] = useState<'denied' | 'unavailable' | null>(null);

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    const start = async () => {
      // Missing outside secure contexts (plain http on a non-local host), whatever the types say.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('unavailable');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch (cause) {
        setError((cause as Error).name === 'NotAllowedError' ? 'denied' : 'unavailable');
        return;
      }
      const video = videoRef.current;
      if (stopped || !video) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      timer = setInterval(() => {
        if (!context || video.readyState < video.HAVE_ENOUGH_DATA) {
          return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'dontInvert',
        });
        if (code?.data) {
          onCodeRef.current(code.data);
        }
      }, SCAN_INTERVAL_MS);
    };
    void start();

    return () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
      }
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, []);

  if (error) {
    return <p className="text-sm text-warn-ink">{t(error)}</p>;
  }
  return (
    <video
      ref={videoRef}
      muted
      playsInline
      aria-label={t('label')}
      className="aspect-video w-full max-w-md rounded-lg border bg-black object-cover"
    />
  );
}
