'use client';

import {
  type ApiError,
  ErrorCode,
  GENDERS,
  MEMBER_SOURCES,
  memberCreateSchema,
  type MemberDto,
  type MemberDuplicatesDto,
  type MemberPhoneTakenDetails,
  type MemberSummaryDto,
  memberUpdateSchema,
  phoneSchema,
} from '@gatefit/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useEffect, useState } from 'react';

import { Field, FormActions, FormMessage } from '@/components/form';
import { useCan } from '@/components/staff-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useApiAction } from '@/lib/use-api';

import type { MemberScope } from './member-scope';
import { fullName, useMemberLocations } from './member-ui';

const CHECK_DELAY_MS = 400;

/** Adds a member (`member` is null) or edits one. Warns about likely duplicates as you type. */
export function MemberForm({
  member,
  scope,
  onSaved,
  onCancel,
}: {
  member: MemberDto | null;
  scope: MemberScope;
  onSaved: (member: MemberDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const canArchive = useCan('members.archive');
  const action = useApiAction();
  const restoring = useApiAction();
  const locations = useMemberLocations(scope);

  const [firstName, setFirstName] = useState(member?.firstName ?? '');
  const [lastName, setLastName] = useState(member?.lastName ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [birthDate, setBirthDate] = useState(member?.birthDate ?? '');
  const [gender, setGender] = useState<string>(member?.gender ?? '');
  const [source, setSource] = useState<string>(member?.source ?? '');
  const [notes, setNotes] = useState(member?.notes ?? '');
  const [emergencyContactName, setEmergencyContactName] = useState(
    member?.emergencyContactName ?? '',
  );
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(
    member?.emergencyContactPhone ?? '',
  );
  const [chosenLocationId, setLocationId] = useState(
    member?.homeLocation.id ?? scope.currentLocationId ?? '',
  );
  const [duplicates, setDuplicates] = useState<MemberDuplicatesDto | null>(null);

  // A location the staff member cannot use falls back to the first one they can.
  const locationOptions = locations.data ?? [];
  const locationId =
    locationOptions.some((location) => location.id === chosenLocationId) ||
    !locations.data ||
    member
      ? chosenLocationId
      : (locationOptions[0]?.id ?? '');

  // Look for members this one may duplicate once the user pauses typing.
  useEffect(() => {
    const parsedPhone = phoneSchema.safeParse(phone);
    const params = new URLSearchParams();
    if (parsedPhone.success) params.set('phone', parsedPhone.data);
    if (firstName.trim() && lastName.trim()) {
      params.set('firstName', firstName.trim());
      params.set('lastName', lastName.trim());
      if (birthDate) params.set('birthDate', birthDate);
    }
    if (member) params.set('excludeId', member.id);
    const enough = params.has('phone') || params.has('firstName');
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!enough) {
        setDuplicates(null);
        return;
      }
      void api
        .get<MemberDuplicatesDto>(`/members/duplicates?${params.toString()}`)
        .then((result) => {
          if (!cancelled) setDuplicates(result.ok ? result.data : null);
        });
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phone, firstName, lastName, birthDate, member]);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = {
      firstName,
      lastName,
      phone,
      birthDate: birthDate || null,
      gender: gender || null,
      source: source || null,
      notes,
      emergencyContactName,
      emergencyContactPhone: emergencyContactPhone.trim() || null,
      homeLocationId: locationId,
    };
    const onConflict = (error: ApiError) => {
      if (error.code === ErrorCode.MEMBER_PHONE_TAKEN) {
        const details = error.details as MemberPhoneTakenDetails | null;
        if (details) setDuplicates({ phoneMatch: details.member, similar: [] });
      }
      return undefined;
    };
    if (member) {
      const input = memberUpdateSchema.safeParse(fields);
      if (!input.success) {
        action.fail();
        return;
      }
      action.run(
        () => api.patch<MemberDto>(`/members/${member.id}`, input.data),
        onSaved,
        onConflict,
      );
    } else {
      const input = memberCreateSchema.safeParse(fields);
      if (!input.success) {
        action.fail();
        return;
      }
      action.run(() => api.post<MemberDto>('/members', input.data), onSaved, onConflict);
    }
  }

  function restore(existing: MemberSummaryDto) {
    restoring.run(
      () => api.post<MemberDto>(`/members/${existing.id}/restore`),
      () => {
        router.push(`/members/${existing.id}`);
      },
    );
  }

  const phoneMatch = duplicates?.phoneMatch ?? null;

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="member-last-name" label={t('members.fields.lastName')}>
          <Input
            id="member-last-name"
            value={lastName}
            maxLength={80}
            required
            autoFocus
            autoComplete="off"
            onChange={(event) => {
              setLastName(event.target.value);
            }}
          />
        </Field>
        <Field id="member-first-name" label={t('members.fields.firstName')}>
          <Input
            id="member-first-name"
            value={firstName}
            maxLength={80}
            required
            autoComplete="off"
            onChange={(event) => {
              setFirstName(event.target.value);
            }}
          />
        </Field>
      </div>

      <Field id="member-phone" label={t('members.fields.phone')}>
        <Input
          id="member-phone"
          type="tel"
          inputMode="tel"
          placeholder={t('auth.phonePlaceholder')}
          value={phone}
          required
          autoComplete="off"
          aria-invalid={phoneMatch ? true : undefined}
          aria-describedby={phoneMatch ? 'member-phone-taken' : undefined}
          onChange={(event) => {
            setPhone(event.target.value);
          }}
        />
      </Field>
      {phoneMatch && (
        <div
          id="member-phone-taken"
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          <span className="flex-1">
            {phoneMatch.archived
              ? t('members.duplicates.phoneTakenArchived', { name: fullName(phoneMatch) })
              : t('members.duplicates.phoneTaken', { name: fullName(phoneMatch) })}
          </span>
          {phoneMatch.archived && canArchive ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={restoring.pending}
              onClick={() => {
                restore(phoneMatch);
              }}
            >
              {t('members.duplicates.restore')}
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" asChild>
              <Link href={`/members/${phoneMatch.id}`}>{t('members.duplicates.open')}</Link>
            </Button>
          )}
        </div>
      )}
      <FormMessage error={restoring.error} />
      {duplicates && duplicates.similar.length > 0 && (
        <div role="status" className="rounded-md border px-3 py-2 text-sm">
          <p>{t('members.duplicates.similar')}</p>
          <ul className="mt-1 list-disc pl-5">
            {duplicates.similar.map((similar) => (
              <li key={similar.id}>
                <Link className="underline" href={`/members/${similar.id}`}>
                  {fullName(similar)}
                </Link>{' '}
                · {similar.phone}
                {similar.birthDate ? ` · ${similar.birthDate}` : ''} · {similar.homeLocation.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="member-birth-date"
          label={t('members.fields.birthDate')}
          optional={t('common.optional')}
        >
          <Input
            id="member-birth-date"
            type="date"
            min="1900-01-01"
            value={birthDate}
            onChange={(event) => {
              setBirthDate(event.target.value);
            }}
          />
        </Field>
        <Field
          id="member-gender"
          label={t('members.fields.gender')}
          optional={t('common.optional')}
        >
          <Select
            id="member-gender"
            value={gender}
            onChange={(event) => {
              setGender(event.target.value);
            }}
          >
            <option value="">{t('members.notSpecified')}</option>
            {GENDERS.map((value) => (
              <option key={value} value={value}>
                {t(`memberFile.gender.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="member-location" label={t('members.fields.homeLocation')}>
          <Select
            id="member-location"
            value={locationId}
            required
            onChange={(event) => {
              setLocationId(event.target.value);
            }}
          >
            {member &&
              !locationOptions.some((location) => location.id === member.homeLocation.id) && (
                <option value={member.homeLocation.id}>{member.homeLocation.name}</option>
              )}
            {locationOptions.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="member-source"
          label={t('members.fields.source')}
          optional={t('common.optional')}
        >
          <Select
            id="member-source"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
            }}
          >
            <option value="">{t('members.notSpecified')}</option>
            {/* "import" marks members brought in from a file; people do not pick it. */}
            {MEMBER_SOURCES.filter((value) => value !== 'import' || value === source).map(
              (value) => (
                <option key={value} value={value}>
                  {t(`memberFile.source.${value}`)}
                </option>
              ),
            )}
          </Select>
        </Field>
        <Field
          id="member-emergency-name"
          label={t('members.fields.emergencyContactName')}
          optional={t('common.optional')}
        >
          <Input
            id="member-emergency-name"
            value={emergencyContactName}
            maxLength={120}
            onChange={(event) => {
              setEmergencyContactName(event.target.value);
            }}
          />
        </Field>
        <Field
          id="member-emergency-phone"
          label={t('members.fields.emergencyContactPhone')}
          optional={t('common.optional')}
        >
          <Input
            id="member-emergency-phone"
            type="tel"
            inputMode="tel"
            placeholder={t('auth.phonePlaceholder')}
            value={emergencyContactPhone}
            onChange={(event) => {
              setEmergencyContactPhone(event.target.value);
            }}
          />
        </Field>
      </div>
      <Field id="member-notes" label={t('members.fields.notes')} optional={t('common.optional')}>
        <textarea
          id="member-notes"
          value={notes}
          maxLength={2000}
          rows={3}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onChange={(event) => {
            setNotes(event.target.value);
          }}
        />
      </Field>

      <FormMessage error={action.error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={action.pending}>
          {t('common.save')}
        </Button>
      </FormActions>
    </form>
  );
}
