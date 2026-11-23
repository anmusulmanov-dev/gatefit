import { getTranslations } from 'next-intl/server';

import { PageFrame } from '@/components/page-frame';

import { PaymentsList } from './payments-list';

export default async function PaymentsPage() {
  const t = await getTranslations('member');
  return (
    <PageFrame align="top">
      <h1 className="text-2xl font-semibold tracking-tight">{t('payments.title')}</h1>
      <PaymentsList />
    </PageFrame>
  );
}
