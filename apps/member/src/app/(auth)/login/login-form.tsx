'use client';

import { errorMessageKey } from '@gatefit/i18n/config';
import { type ApiError, otpRequestSchema, otpVerifySchema } from '@gatefit/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState, useTransition } from 'react';

import { api } from '@/lib/api';

type Step =
  | { name: 'phone' }
  /** A code was sent to this number (normalized to international format). */
  | { name: 'code'; phone: string };

export function LoginForm() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<Step>({ name: 'phone' });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const showError = (apiError: ApiError) => {
    setError(t(errorMessageKey(apiError.code)));
  };

  async function requestCode(rawPhone: string): Promise<void> {
    // The same schema the API validates with.
    const input = otpRequestSchema.safeParse({ phone: rawPhone });
    if (!input.success) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    const result = await api.post('/auth/otp/request', input.data);
    if (!result.ok) {
      showError(result.error);
      return;
    }
    setCode('');
    setStep({ name: 'code', phone: input.data.phone });
  }

  async function verifyCode(sentTo: string): Promise<void> {
    const input = otpVerifySchema.safeParse({ phone: sentTo, code });
    if (!input.success) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    const result = await api.post('/auth/otp/verify', input.data);
    if (!result.ok) {
      showError(result.error);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    startTransition(() => (step.name === 'phone' ? requestCode(phone) : verifyCode(step.phone)));
  }

  const errorProps = {
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': error ? 'form-error' : undefined,
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('auth.memberTitle')}</h1>
        <p className="text-muted-foreground">
          {step.name === 'phone'
            ? t('auth.memberIntro')
            : t('auth.codeSentTo', { phone: step.phone })}
        </p>
      </div>

      {step.name === 'phone' ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="phone" className="text-sm font-medium">
            {t('auth.phone')}
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={t('auth.phonePlaceholder')}
            className="field"
            required
            autoFocus
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
            {...errorProps}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor="code" className="text-sm font-medium">
            {t('auth.smsCode')}
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            className="field text-center text-2xl tracking-[0.4em]"
            required
            autoFocus
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, ''));
            }}
            {...errorProps}
          />
        </div>
      )}

      {error && (
        <p id="form-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <button type="submit" className="button-primary" disabled={pending}>
          {step.name === 'phone' ? t('auth.sendCode') : t('auth.signIn')}
        </button>
        {step.name === 'code' && (
          <>
            <button
              type="button"
              className="button-quiet"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(() => requestCode(step.phone));
              }}
            >
              {t('auth.resendCode')}
            </button>
            <button
              type="button"
              className="button-quiet"
              disabled={pending}
              onClick={() => {
                setError(null);
                setStep({ name: 'phone' });
              }}
            >
              {t('auth.changePhone')}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
