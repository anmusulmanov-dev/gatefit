import { LOCALE_COOKIE, messages, resolveLocale } from '@gatefit/i18n';
import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

// The locale lives in a cookie, not in the URL: the panel sits behind login and
// the tenant is identified by subdomain.
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  return { locale, messages: messages[locale] };
});
