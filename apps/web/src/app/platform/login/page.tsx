import { redirect } from 'next/navigation';

import { CenteredPage } from '@/components/centered-page';
import { getPlatformSession } from '@/lib/platform-session';

import { PlatformLoginForm } from './platform-login-form';

export default async function PlatformLoginPage() {
  if ((await getPlatformSession()).kind === 'authenticated') {
    redirect('/platform/organizations');
  }
  return (
    <CenteredPage>
      <PlatformLoginForm />
    </CenteredPage>
  );
}
