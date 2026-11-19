import { Outlet } from 'react-router';
import { useSession } from '../auth/session-context';
import { PageTabs } from '../layout/PageTabs';

const TABS = [
  { to: '/orders', label: 'Orders', end: true },
  { to: '/orders/refunds', label: 'Refunds' },
];

// The orders, and for Super Users a tab of their refunds (ADR 0037).
// Admins never handle money, so they see no tabs at all, and the Refunds
// address tells them it is for Super Users (App.tsx).
export function OrdersLayout() {
  const { state } = useSession();
  const superUser =
    state.status === 'signed-in' && state.staff.role === 'SUPER_USER';
  return (
    <div>
      {superUser ? (
        <PageTabs
          label="Orders and refunds"
          tabs={TABS}
          layoutId="orders-tab"
        />
      ) : null}
      <Outlet />
    </div>
  );
}
