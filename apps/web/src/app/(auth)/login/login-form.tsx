'use client';

import { errorMessageKey } from '@gatefit/i18n/config';
import {
  type ApiError,
  ErrorCode,
  newPasswordSchema,
  passwordChangeRequiredDetailsSchema,
  staffLoginSchema,
  totpConfirmSchema,
  totpSetupRequiredDetailsSchema,
  type TotpSetupResponse,
} from '@gatefit/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

type Step =
  | { name: 'credentials' }
  /** The password was given by someone else and must be replaced first. */
  | { name: 'newPassword'; changeToken: string }
  /** The account has an authenticator: the same credentials are sent again with a code. */
  | { name: 'totp' }
  /** The role requires an authenticator that is not set up yet. */
  | ({ name: 'setup' } & TotpSetupResponse);

export function LoginForm() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<Step>({ name: 'credentials' });
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const showError = (apiError: ApiError) => {
    setError(t(errorMessageKey(apiError.code)));
  };
  const enter = () => {
    router.replace('/');
    router.refresh();
  };
  const backToCredentials = () => {
    setStep({ name: 'credentials' });
    setCode('');
    setError(null);
  };

  async function beginSetup(details: unknown): Promise<void> {
    const parsed = totpSetupRequiredDetailsSchema.safeParse(details);
    const setup = parsed.success
      ? await api.post<TotpSetupResponse>('/auth/totp/setup', parsed.data)
      : null;
    if (!setup?.ok) {
      setError(t('errors.generic'));
      return;
    }
    setCode('');
    setStep({ name: 'setup', ...setup.data });
  }

  // `withPassword` is passed right after a new password was set, before state catches up.
  async function signIn(withPassword = password): Promise<void> {
    // The same schema the API validates with.
    const input = staffLoginSchema.safeParse({
      phone,
      password: withPassword,
      totpCode: step.name === 'totp' ? code : undefined,
    });
    if (!input.success) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }

    const result = await api.post('/auth/login', input.data);
    if (result.ok) {
      enter();
      return;
    }
    switch (result.error.code) {
      case ErrorCode.TOTP_REQUIRED:
        setCode('');
        setStep({ name: 'totp' });
        return;
      case ErrorCode.TOTP_SETUP_REQUIRED:
        await beginSetup(result.error.details);
        return;
      case ErrorCode.PASSWORD_CHANGE_REQUIRED: {
        const details = passwordChangeRequiredDetailsSchema.safeParse(result.error.details);
        if (!details.success) {
          setError(t('errors.generic'));
          return;
        }
        setNewPassword('');
        setConfirmPassword('');
        setStep({ name: 'newPassword', changeToken: details.data.changeToken });
        return;
      }
      default:
        showError(result.error);
    }
  }

  async function replacePassword(changeToken: string): Promise<void> {
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordsMismatch'));
      return;
    }
    if (!newPasswordSchema.safeParse(newPassword).success) {
      setError(t('account.passwordHint'));
      return;
    }
    const result = await api.post('/auth/password/set', { changeToken, newPassword });
    if (!result.ok) {
      showError(result.error);
      return;
    }
    // Setting the password opens no session: sign in with it, which may ask for TOTP next.
    setPassword(newPassword);
    setStep({ name: 'credentials' });
    await signIn(newPassword);
  }

  async function confirmSetup(enrollToken: string): Promise<void> {
    const input = totpConfirmSchema.safeParse({ enrollToken, code });
    if (!input.success) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    const result = await api.post('/auth/totp/confirm', input.data);
    if (result.ok) {
      enter();
    } else {
      showError(result.error);
    }
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    startTransition(() => {
      switch (step.name) {
        case 'setup':
          return confirmSetup(step.enrollToken);
        case 'newPassword':
          return replacePassword(step.changeToken);
        default:
          return signIn();
      }
    });
  }

  const codeField = (
    <div className="flex flex-col gap-2">
      <Label htmlFor="code">{t('auth.totpCode')}</Label>
      <Input
        id="code"
        name="code"
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
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'form-error' : undefined}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {step.name === 'credentials' && t('auth.signIn')}
          {step.name === 'totp' && t('auth.totpTitle')}
          {step.name === 'setup' && t('auth.totpSetupTitle')}
          {step.name === 'newPassword' && t('auth.newPasswordTitle')}
        </CardTitle>
        {step.name === 'newPassword' && (
          <CardDescription>{t('auth.newPasswordHint')}</CardDescription>
        )}
        {step.name === 'totp' && <CardDescription>{t('auth.totpHint')}</CardDescription>}
        {step.name === 'setup' && <CardDescription>{t('auth.totpSetupIntro')}</CardDescription>}
      </CardHeader>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {step.name === 'credentials' && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">{t('auth.phone')}</Label>
              <Input
                id="phone"
                name="phone"
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
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'form-error' : undefined}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'form-error' : undefined}
              />
            </div>
          </>
        )}

        {step.name === 'totp' && codeField}

        {step.name === 'newPassword' && (
          <>
            {/* Lets password managers save the new password under the right account. */}
            <input type="hidden" name="username" autoComplete="username" value={phone} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">{t('auth.newPassword')}</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                autoFocus
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                }}
                aria-describedby="new-password-hint"
              />
              <p id="new-password-hint" className="text-sm text-muted-foreground">
                {t('account.passwordHint')}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-password">{t('auth.confirmPassword')}</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'form-error' : undefined}
              />
            </div>
          </>
        )}

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

        {error && (
          <p id="form-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Button type="submit" disabled={pending}>
            {step.name === 'credentials' ? t('auth.signIn') : t('auth.confirm')}
          </Button>
          {step.name !== 'credentials' && (
            <Button type="button" variant="ghost" disabled={pending} onClick={backToCredentials}>
              {t('auth.back')}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
