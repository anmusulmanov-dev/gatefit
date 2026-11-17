import { redirect } from 'next/navigation';

import { CenteredPage } from '@/components/centered-page';
import { OrganizationNotice } from '@/components/session-gate';
import { isPlatformHost, requestHost } from '@/lib/host';
import { getSession } from '@/lib/session';

import { LoginForm } from './login-form';

export default async function LoginPage() {
  if (isPlatformHost(await requestHost())) {
    redirect('/platform/login');
  }
  const session = await getSession();

  if (session.kind === 'authenticated' && session.me.staff) {
    redirect('/');
  }
  if (session.kind !== 'authenticated' && session.kind !== 'unauthenticated') {
    return <OrganizationNotice kind={session.kind} />;
  }

  return (
    <CenteredPage>
      <LoginForm />
    </CenteredPage>
  );
}
