'use client';

import { errorMessageKey } from '@gatefit/i18n/config';
import {
  ErrorCode,
  platformLoginSchema,
  totpConfirmSchema,
  totpSetupRequiredDetailsSchema,
  type TotpSetupResponse,
} from '@gatefit/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState, useTransition } from 'react';

import { Field, FormMessage } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { platformApi } from '@/lib/platform-api';

type Step = { name: 'credentials' } | { name: 'totp' } | ({ name: 'setup' } & TotpSetupResponse);

/** Operator sign-in: phone and password, then always an authenticator code. */
export function PlatformLoginForm() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>({ name: 'credentials' });
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const enter = () => {
    router.replace('/platform/organizations');
    router.refresh();
  };

  async function signIn() {
    const input = platformLoginSchema.safeParse({
      phone,
      password,
      totpCode: step.name === 'totp' ? code : undefined,
    });
    if (!input.success) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    const result = await platformApi.post('/auth/login', input.data);
    if (result.ok) {
      enter();
      return;
    }
    if (result.error.code === ErrorCode.TOTP_REQUIRED) {
      setCode('');
      setStep({ name: 'totp' });
      return;
    }
    if (result.error.code === ErrorCode.TOTP_SETUP_REQUIRED) {
      const details = totpSetupRequiredDetailsSchema.safeParse(result.error.details);
      const setup = details.success
        ? await platformApi.post<TotpSetupResponse>('/auth/totp/setup', details.data)
        : null;
      if (setup?.ok) {
        setCode('');
        setStep({ name: 'setup', ...setup.data });
      } else {
        setError(t('errors.generic'));
      }
      return;
    }
    setError(t(errorMessageKey(result.error.code)));
  }

  async function confirmSetup(enrollToken: string) {
    const input = totpConfirmSchema.safeParse({ enrollToken, code });
    if (!input.success) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    const result = await platformApi.post('/auth/totp/confirm', input.data);
    if (result.ok) {
      enter();
    } else {
      setError(t(errorMessageKey(result.error.code)));
    }
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(() => (step.name === 'setup' ? confirmSetup(step.enrollToken) : signIn()));
  }

  const codeField = (
    <Field id="code" label={t('auth.totpCode')}>
      <Input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        value={code}
        onChange={(event) => {
          setCode(event.target.value.replace(/\D/g, ''));
        }}
      />
    </Field>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {step.name === 'setup' ? t('auth.totpSetupTitle') : t('platform.signInTitle')}
        </CardTitle>
        {step.name === 'totp' && <CardDescription>{t('auth.totpHint')}</CardDescription>}
        {step.name === 'setup' && <CardDescription>{t('auth.totpSetupIntro')}</CardDescription>}
      </CardHeader>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {step.name === 'credentials' && (
          <>
            <Field id="phone" label={t('auth.phone')}>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="username"
                placeholder={t('auth.phonePlaceholder')}
                required
                autoFocus
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
              />
            </Field>
            <Field id="password" label={t('auth.password')}>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            </Field>
          </>
        )}
        {step.name === 'totp' && codeField}
        {step.name === 'setup' && (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('auth.totpSecret')}</span>
              <code className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all select-all">
                {step.secret}
              </code>
              <a className="text-sm underline underline-offset-4" href={step.otpauthUrl}>
                {t('auth.totpOpenApp')}
              </a>
            </div>
            {codeField}
          </>
        )}
        <FormMessage error={error} />
        <div className="flex flex-col gap-2">
          <Button type="submit" disabled={pending}>
            {step.name === 'credentials' ? t('auth.signIn') : t('auth.confirm')}
          </Button>
          {step.name !== 'credentials' && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setStep({ name: 'credentials' });
                setError(null);
              }}
            >
              {t('auth.back')}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
