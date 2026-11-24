import { redirect } from 'next/navigation';

import { PageFrame } from '@/components/page-frame';
import { OrganizationNotice } from '@/components/session-gate';
import { getSession } from '@/lib/session';

import { LoginForm } from './login-form';

export default async function LoginPage() {
  const session = await getSession();

  if (session.kind === 'authenticated') {
    redirect('/');
  }
  if (session.kind !== 'unauthenticated') {
    return <OrganizationNotice kind={session.kind} />;
  }

  return (
    <PageFrame brand>
      <LoginForm />
    </PageFrame>
  );
}
