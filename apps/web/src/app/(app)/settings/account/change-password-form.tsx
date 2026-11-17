'use client';

import { ErrorCode, passwordChangeSchema } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useApiAction } from '@/lib/use-api';

export function ChangePasswordForm() {
  const t = useTranslations();
  const action = useApiAction();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changed, setChanged] = useState(false);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setChanged(false);
    if (newPassword !== confirmPassword) {
      action.fail(t('auth.passwordsMismatch'));
      return;
    }
    const input = passwordChangeSchema.safeParse({ currentPassword, newPassword });
    if (!input.success) {
      action.fail(t('account.passwordHint'));
      return;
    }
    action.run(
      () => api.post('/auth/password/change', input.data),
      () => {
        setChanged(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      },
      // The standard message mentions the phone, which this form does not ask for.
      (error) =>
        error.code === ErrorCode.INVALID_CREDENTIALS ? t('account.wrongCurrent') : undefined,
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4" noValidate>
      <Field id="current-password" label={t('account.currentPassword')}>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => {
            setCurrentPassword(event.target.value);
          }}
        />
      </Field>
      <Field id="new-password" label={t('account.newPassword')} hint={t('account.passwordHint')}>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          onChange={(event) => {
            setNewPassword(event.target.value);
          }}
        />
      </Field>
      <Field id="confirm-password" label={t('account.confirmPassword')}>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
          }}
        />
      </Field>
      <FormMessage error={action.error} success={changed ? t('account.changed') : null} />
      <FormActions>
        <Button type="submit" disabled={action.pending}>
          {t('account.change')}
        </Button>
      </FormActions>
    </form>
  );
}
