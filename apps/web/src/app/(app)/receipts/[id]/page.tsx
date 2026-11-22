import { RequirePermission } from '../../settings/require-permission';
import { Receipt } from './receipt';

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="payments.read">
      <Receipt id={id} />
    </RequirePermission>
  );
}
