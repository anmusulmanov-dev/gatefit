'use client';

import {
  locationCreateSchema,
  type LocationDto,
  locationUpdateSchema,
  WEEKDAYS,
  type WorkingHours,
} from '@gatefit/shared';
import { useTranslations } from 'next-intl';
import { type SubmitEvent, useMemo, useState } from 'react';

import { CheckboxRow, Field, FormActions, FormMessage } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useApiAction } from '@/lib/use-api';

const DEFAULT_TIMEZONE = 'Asia/Tashkent';
const DEFAULT_DAY = { open: '07:00', close: '22:00' };

function defaultHours(): WorkingHours {
  return Object.fromEntries(WEEKDAYS.map((day) => [day, { ...DEFAULT_DAY }])) as WorkingHours;
}

/** Adds a location (`location` is null) or edits one. */
export function LocationDialog({
  location,
  onClose,
  onSaved,
}: {
  location: LocationDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const action = useApiAction();
  const timezones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);

  const [name, setName] = useState(location?.name ?? '');
  const [address, setAddress] = useState(location?.address ?? '');
  const [timezone, setTimezone] = useState(location?.timezone ?? DEFAULT_TIMEZONE);
  const [hours, setHours] = useState<WorkingHours | null>(location?.workingHours ?? null);

  function setDay(day: (typeof WEEKDAYS)[number], value: WorkingHours[typeof day]) {
    setHours((current) => (current ? { ...current, [day]: value } : current));
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = { name, address: address.trim() || null, timezone, workingHours: hours };
    if (location) {
      const input = locationUpdateSchema.safeParse(values);
      if (!input.success) {
        action.fail();
        return;
      }
      action.run(() => api.patch(`/locations/${location.id}`, input.data), onSaved);
    } else {
      const input = locationCreateSchema.safeParse(values);
      if (!input.success) {
        action.fail();
        return;
      }
      action.run(() => api.post('/locations', input.data), onSaved);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={location ? t('locations.edit') : t('locations.add')}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="location-name" label={t('locations.name')}>
          <Input
            id="location-name"
            value={name}
            maxLength={120}
            required
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field id="location-address" label={t('locations.address')} optional={t('common.optional')}>
          <Input
            id="location-address"
            value={address}
            maxLength={300}
            onChange={(event) => {
              setAddress(event.target.value);
            }}
          />
        </Field>
        <Field id="location-timezone" label={t('locations.timezone')}>
          <Select
            id="location-timezone"
            value={timezone}
            onChange={(event) => {
              setTimezone(event.target.value);
            }}
          >
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">{t('locations.workingHours')}</legend>
          <CheckboxRow
            label={t('locations.setHours')}
            checked={hours !== null}
            onChange={(event) => {
              setHours(event.target.checked ? defaultHours() : null);
            }}
          />
          {hours &&
            WEEKDAYS.map((day) => {
              const value = hours[day];
              const dayName = t(`locations.days.${day}`);
              return (
                <div key={day} className="grid grid-cols-[7rem_1fr] items-center gap-2 text-sm">
                  <span>{dayName}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <CheckboxRow
                      label={t('locations.closed')}
                      aria-label={`${dayName}: ${t('locations.closed')}`}
                      checked={value === null}
                      onChange={(event) => {
                        setDay(day, event.target.checked ? null : { ...DEFAULT_DAY });
                      }}
                    />
                    {value && (
                      <>
                        <Input
                          type="time"
                          aria-label={`${dayName}: ${t('locations.opens')}`}
                          className="h-8 w-28"
                          value={value.open}
                          onChange={(event) => {
                            setDay(day, { ...value, open: event.target.value });
                          }}
                        />
                        <span aria-hidden>–</span>
                        <Input
                          type="time"
                          aria-label={`${dayName}: ${t('locations.closes')}`}
                          className="h-8 w-28"
                          value={value.close}
                          onChange={(event) => {
                            setDay(day, { ...value, close: event.target.value });
                          }}
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
        </fieldset>

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
    </Dialog>
  );
}
