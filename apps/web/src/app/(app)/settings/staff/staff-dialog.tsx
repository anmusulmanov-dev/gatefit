'use client';

import {
  type LocationDto,
  type RoleDto,
  staffCreateSchema,
  type StaffDto,
  staffPasswordResetSchema,
  staffUpdateSchema,
} from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { CheckboxRow, Field, FormActions, FormMessage } from '@/components/form';
import { useHoldsAll, useStaffSession } from '@/components/staff-session';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useRoleName } from '@/lib/role-name';
import { generateTemporaryPassword } from '@/lib/temporary-password';
import { useApiAction } from '@/lib/use-api';

const isOwnerRole = (role: { name: string; isSystem: boolean }) =>
  role.isSystem && role.name === 'owner';

/** Adds a staff member (`staff` is null) or edits one, including credential resets. */
export function StaffDialog({
  staff,
  roles,
  locations,
  onClose,
  onSaved,
  onChanged,
}: {
  staff: StaffDto | null;
  roles: RoleDto[];
  locations: LocationDto[];
  onClose: () => void;
  /** After the main form is saved: the dialog closes. */
  onSaved: () => void;
  /** After a reset: the dialog stays open, the list refreshes. */
  onChanged: () => void;
}) {
  const t = useTranslations();
  const roleName = useRoleName();
  const holdsAll = useHoldsAll();
  const { staffId: myStaffId } = useStaffSession();
  const action = useApiAction();

  // The API refuses roles wider than the caller's own: offer only those.
  const assignable = roles.filter((role) => holdsAll(role.permissions));
  const currentRole = staff ? roles.find((role) => role.id === staff.role.id) : undefined;
  const isSelf = staff?.id === myStaffId;
  const targetIsStronger = !!currentRole && !holdsAll(currentRole.permissions);
  const roleLocked = isSelf || targetIsStronger;

  const [phone, setPhone] = useState(staff?.phone ?? '');
  const [firstName, setFirstName] = useState(staff?.firstName ?? '');
  const [lastName, setLastName] = useState(staff?.lastName ?? '');
  const [position, setPosition] = useState(staff?.position ?? '');
  const [roleId, setRoleId] = useState(
    staff?.role.id ?? assignable.find((role) => !role.isSystem || role.name !== 'owner')?.id ?? '',
  );
  const [locationIds, setLocationIds] = useState<Set<string>>(
    new Set(staff?.locations.map((location) => location.id) ?? []),
  );
  const [status, setStatus] = useState(staff?.status ?? 'active');
  const [temporaryPassword, setTemporaryPassword] = useState(() =>
    staff ? '' : generateTemporaryPassword(),
  );

  function toggleLocation(id: string, on: boolean) {
    setLocationIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const common = {
      firstName,
      lastName,
      position: position.trim() || null,
      locationIds: [...locationIds],
    };
    if (staff) {
      const input = staffUpdateSchema.safeParse({
        ...common,
        // Unchanged role and status are left out, so they need no extra rights.
        ...(roleId !== staff.role.id ? { roleId } : {}),
        ...(status !== staff.status ? { status } : {}),
      });
      if (!input.success) {
        action.fail();
        return;
      }
      action.run(() => api.patch(`/staff/${staff.id}`, input.data), onSaved);
    } else {
      const input = staffCreateSchema.safeParse({ ...common, phone, roleId, temporaryPassword });
      if (!input.success) {
        action.fail();
        return;
      }
      action.run(() => api.post('/staff', input.data), onSaved);
    }
  }

  // Roles in the select: those the caller may assign, plus the current one (shown, locked).
  const roleOptions =
    currentRole && !assignable.includes(currentRole) ? [currentRole, ...assignable] : assignable;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={staff ? t('staffSettings.edit') : t('staffSettings.add')}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="staff-phone" label={t('staffSettings.phone')}>
          <Input
            id="staff-phone"
            type="tel"
            inputMode="tel"
            placeholder={t('auth.phonePlaceholder')}
            value={phone}
            required
            disabled={!!staff}
            autoFocus={!staff}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="staff-first-name" label={t('staffSettings.firstName')}>
            <Input
              id="staff-first-name"
              value={firstName}
              maxLength={80}
              required
              autoFocus={!!staff}
              onChange={(event) => {
                setFirstName(event.target.value);
              }}
            />
          </Field>
          <Field id="staff-last-name" label={t('staffSettings.lastName')}>
            <Input
              id="staff-last-name"
              value={lastName}
              maxLength={80}
              required
              onChange={(event) => {
                setLastName(event.target.value);
              }}
            />
          </Field>
        </div>
        <Field
          id="staff-position"
          label={t('staffSettings.position')}
          optional={t('common.optional')}
        >
          <Input
            id="staff-position"
            value={position}
            maxLength={120}
            onChange={(event) => {
              setPosition(event.target.value);
            }}
          />
        </Field>
        <Field
          id="staff-role"
          label={t('staffSettings.role')}
          hint={
            isSelf
              ? t('staffSettings.selfHint')
              : targetIsStronger
                ? t('staffSettings.strongerHint')
                : t('staffSettings.noRolesHint')
          }
        >
          <Select
            id="staff-role"
            value={roleId}
            disabled={roleLocked}
            onChange={(event) => {
              setRoleId(event.target.value);
            }}
          >
            {roleOptions.map((role) => (
              <option key={role.id} value={role.id}>
                {roleName(role)}
              </option>
            ))}
          </Select>
        </Field>

        {locations.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('staffSettings.locations')}</legend>
            {locations.map((location) => (
              <CheckboxRow
                key={location.id}
                label={location.name}
                checked={locationIds.has(location.id)}
                onChange={(event) => {
                  toggleLocation(location.id, event.target.checked);
                }}
              />
            ))}
          </fieldset>
        )}

        {staff ? (
          <Field id="staff-status-edit" label={t('staffSettings.status')}>
            <Select
              id="staff-status-edit"
              value={status}
              disabled={roleLocked}
              onChange={(event) => {
                setStatus(event.target.value as 'active' | 'inactive');
              }}
            >
              <option value="active">{t('staffSettings.statusValues.active')}</option>
              <option value="inactive">{t('staffSettings.statusValues.inactive')}</option>
            </Select>
          </Field>
        ) : (
          <TemporaryPasswordField value={temporaryPassword} onChange={setTemporaryPassword} />
        )}

        <FormMessage error={action.error} />
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={action.pending}>
            {t('common.save')}
          </Button>
        </FormActions>
      </form>

      {staff && !isSelf && (
        <CredentialResets
          staff={staff}
          blockedReason={
            isOwnerRole(staff.role)
              ? t('staffSettings.ownerHint')
              : targetIsStronger
                ? t('staffSettings.strongerHint')
                : null
          }
          onChanged={onChanged}
        />
      )}
    </Dialog>
  );
}

function TemporaryPasswordField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('staffSettings');
  return (
    <Field
      id="staff-temporary-password"
      label={t('temporaryPassword')}
      hint={t('temporaryPasswordHint')}
    >
      <div className="flex gap-2">
        <Input
          id="staff-temporary-password"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          value={value}
          minLength={8}
          required
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onChange(generateTemporaryPassword());
          }}
        >
          {t('generate')}
        </Button>
      </div>
    </Field>
  );
}

/** Password and authenticator resets, separate from the profile form. */
function CredentialResets({
  staff,
  blockedReason,
  onChanged,
}: {
  staff: StaffDto;
  blockedReason: string | null;
  onChanged: () => void;
}) {
  const t = useTranslations();
  const passwordAction = useApiAction();
  const totpAction = useApiAction();
  const [temporaryPassword, setTemporaryPassword] = useState(generateTemporaryPassword);
  const [done, setDone] = useState<string | null>(null);

  if (blockedReason) {
    return <p className="border-t pt-4 text-sm text-muted-foreground">{blockedReason}</p>;
  }

  function resetPassword(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(null);
    const input = staffPasswordResetSchema.safeParse({ temporaryPassword });
    if (!input.success) {
      passwordAction.fail(t('account.passwordHint'));
      return;
    }
    passwordAction.run(
      () => api.post(`/staff/${staff.id}/reset-password`, input.data),
      () => {
        setDone(t('staffSettings.passwordResetDone'));
        onChanged();
      },
    );
  }

  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      <form onSubmit={resetPassword} className="flex flex-col gap-3" noValidate>
        <p className="text-sm text-muted-foreground">{t('staffSettings.resetPasswordHint')}</p>
        <TemporaryPasswordField value={temporaryPassword} onChange={setTemporaryPassword} />
        <FormMessage error={passwordAction.error} success={done} />
        <FormActions>
          <Button type="submit" variant="outline" disabled={passwordAction.pending}>
            {t('staffSettings.resetPassword')}
          </Button>
        </FormActions>
      </form>

      {staff.totpEnabled && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t('staffSettings.resetTotpHint')}</p>
          <FormMessage error={totpAction.error} />
          <FormActions>
            <Button
              type="button"
              variant="outline"
              disabled={totpAction.pending}
              onClick={() => {
                setDone(null);
                totpAction.run(
                  () => api.post(`/staff/${staff.id}/reset-totp`),
                  () => {
                    setDone(t('staffSettings.totpResetDone'));
                    onChanged();
                  },
                );
              }}
            >
              {t('staffSettings.resetTotp')}
            </Button>
          </FormActions>
        </div>
      )}
    </div>
  );
}
