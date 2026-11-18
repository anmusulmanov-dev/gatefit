'use client';

import { type Permission, roleCreateSchema, type RoleDto, roleUpdateSchema } from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useState } from 'react';

import { CheckboxRow, Field, FormActions, FormMessage } from '@/components/form';
import { useStaffSession } from '@/components/staff-session';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { PERMISSION_GROUPS } from '@/lib/permission-groups';
import { useRoleName } from '@/lib/role-name';
import { useApiAction } from '@/lib/use-api';

/**
 * Creates a role (`role` is null), edits a custom one, or shows the permissions of one
 * the user may not change (`editable` false).
 */
export function RoleDialog({
  role,
  editable,
  onClose,
  onSaved,
}: {
  role: RoleDto | null;
  editable: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const roleName = useRoleName();
  const { permissions: held } = useStaffSession();
  const action = useApiAction();
  const archiveAction = useApiAction();

  const [name, setName] = useState(role?.name ?? '');
  const [granted, setGranted] = useState<Set<Permission>>(new Set(role?.permissions ?? []));

  function toggle(permission: Permission, on: boolean) {
    setGranted((current) => {
      const next = new Set(current);
      if (on) {
        next.add(permission);
      } else {
        next.delete(permission);
      }
      return next;
    });
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = { name, permissions: [...granted] };
    if (role) {
      const input = roleUpdateSchema.safeParse(values);
      if (!input.success) {
        action.fail();
        return;
      }
      action.run(() => api.patch(`/roles/${role.id}`, input.data), onSaved);
    } else {
      const input = roleCreateSchema.safeParse(values);
      if (!input.success) {
        action.fail();
        return;
      }
      action.run(() => api.post('/roles', input.data), onSaved);
    }
  }

  const title = !role
    ? t('rolesSettings.add')
    : editable
      ? t('rolesSettings.edit')
      : roleName(role);
  const description = !editable
    ? role?.isSystem
      ? t('rolesSettings.systemReadOnly')
      : undefined
    : t('rolesSettings.notHeldHint');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={description}
      className="max-w-2xl"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {editable && (
          <Field id="role-name" label={t('rolesSettings.name')}>
            <Input
              id="role-name"
              value={name}
              maxLength={60}
              required
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
        )}

        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {PERMISSION_GROUPS.map((group) => (
            <fieldset key={group.area} className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">
                {t(`permissionAreas.${group.area}`)}
              </legend>
              {group.permissions.map((permission) => (
                <CheckboxRow
                  key={permission}
                  label={t(`permissions.${permission}`)}
                  checked={granted.has(permission)}
                  // A permission you do not hold cannot be granted (the API refuses it too),
                  // but one already on the role can still be taken away.
                  disabled={!editable || (!held.has(permission) && !granted.has(permission))}
                  onChange={(event) => {
                    toggle(permission, event.target.checked);
                  }}
                />
              ))}
            </fieldset>
          ))}
        </div>

        <FormMessage error={action.error ?? archiveAction.error} />
        <FormActions>
          {editable && role && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-destructive"
              disabled={archiveAction.pending}
              title={t('rolesSettings.archiveHint')}
              onClick={() => {
                archiveAction.run(
                  () => api.patch(`/roles/${role.id}`, { archived: true }),
                  onSaved,
                );
              }}
            >
              {t('rolesSettings.archive')}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            {editable ? t('common.cancel') : t('common.close')}
          </Button>
          {editable && (
            <Button type="submit" disabled={action.pending}>
              {t('common.save')}
            </Button>
          )}
        </FormActions>
      </form>
    </Dialog>
  );
}
