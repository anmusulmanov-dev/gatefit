import { memberScope } from '../members/member-scope';
import { RequirePermission } from '../settings/require-permission';
import { ShopDesk } from './shop-desk';

export default async function ShopPage() {
  return (
    <RequirePermission permission="shop.sell">
      <ShopDesk scope={await memberScope()} />
    </RequirePermission>
  );
}
