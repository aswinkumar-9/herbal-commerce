import { MailWarning, Plus, Users, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { problemMessage } from '../api/problems';
import { EmptyList, ListLoading, LoadFailed } from '../catalog/list-states';
import { Link } from 'react-router';
import { Button, buttonClass } from '../components/Button';
import { STAGGER, rise, transition } from '../motion';
import { usePageTitle } from '../page-title';
import { AdminActionDialog, InviteDialog } from './AdminDialogs';
import type { AdminAction } from './AdminDialogs';
import {
  ADMIN_STATE_NAMES,
  ADMIN_STATE_STYLES,
  adminDetail,
  adminState,
} from './admin-display';
import type { AdminState } from './admin-display';
import type { Admin } from './admins-api';
import { useAdmins } from './admins-queries';

const TAG =
  'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-chip inset-shadow-clay';

// The steps each Admin can take next, the gentler one first.
const ACTIONS: Record<AdminState, { action: AdminAction; label: string }[]> = {
  ACTIVE: [
    { action: 'reset', label: 'Reset authenticator app' },
    { action: 'disable', label: 'Disable' },
  ],
  NEEDS_APP: [
    { action: 'reset', label: 'Send a new link' },
    { action: 'disable', label: 'Disable' },
  ],
  INVITED: [
    { action: 'resend', label: 'Send the invitation again' },
    { action: 'remove', label: 'Remove' },
  ],
  INVITATION_ENDED: [
    { action: 'resend', label: 'Send the invitation again' },
    { action: 'remove', label: 'Remove' },
  ],
  DISABLED: [
    { action: 'enable', label: 'Enable' },
    { action: 'remove', label: 'Remove' },
  ],
};

interface Acting {
  action: AdminAction;
  admin: Admin;
  open: boolean;
}

// The Admins, for Super Users only (ADR 0004, ADR 0038): who packs and
// ships the orders and looks after the catalog and stock. A Super User
// invites them, sends the invitation again, resets the authenticator app
// of one who lost their phone, and disables, enables or removes them.
export function AdminsPage() {
  usePageTitle('Admins');
  const admins = useAdmins();
  const [inviting, setInviting] = useState(false);
  // The last step chosen stays while its dialog closes, so it can fade.
  const [acting, setActing] = useState<Acting | null>(null);
  // An email that could not be sent stays said until it is read.
  const [unsent, setUnsent] = useState<string | null>(null);

  const invite = (
    <Button variant="primary" icon={Plus} onClick={() => setInviting(true)}>
      Invite an Admin
    </Button>
  );

  return (
    <section className="max-w-4xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Admins</h1>
          <p className="mt-1 text-ink-muted">
            They pack and ship the orders, and look after the catalog and stock.
            Each signs in with their own password and an authenticator app.
          </p>
        </div>
        {invite}
      </header>

      <AnimatePresence initial={false}>
        {unsent ? (
          <motion.div
            key="unsent"
            variants={rise}
            initial="hidden"
            animate="shown"
            exit="gone"
            role="alert"
            className="mt-6 flex items-start gap-3 rounded-card border border-warning/40 bg-warning-soft p-4 text-sm text-ink shadow-clay inset-shadow-clay"
          >
            <MailWarning
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-warning"
            />
            <p className="flex-1">{unsent}</p>
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={() => setUnsent(null)}
            >
              Dismiss
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {admins.isPending ? (
        <ListLoading label="Loading the Admins…" />
      ) : admins.isError && !admins.data ? (
        <LoadFailed
          title="The Admins could not be loaded"
          message={problemMessage(admins.error)}
          retrying={admins.isFetching}
          onRetry={() => void admins.refetch()}
        />
      ) : admins.data.length === 0 ? (
        <EmptyList icon={Users} title="No Admins yet" action={invite}>
          Invite the people who pack and ship the orders.
        </EmptyList>
      ) : (
        <ul
          aria-label="Admins"
          className="mt-6 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-clay inset-shadow-clay"
        >
          <AnimatePresence initial={false}>
            {admins.data.map((admin, index) => (
              <motion.li
                key={admin.id}
                layout="position"
                initial={{ opacity: 0, y: 6 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: {
                    ...transition,
                    delay: Math.min(index, 10) * STAGGER,
                  },
                }}
                exit={{ opacity: 0, transition }}
                className="px-4 py-3"
              >
                <AdminRow
                  admin={admin}
                  now={admins.dataUpdatedAt}
                  onAct={(action) => setActing({ action, admin, open: true })}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        onEmailFailed={setUnsent}
      />
      {acting ? (
        <AdminActionDialog
          open={acting.open}
          action={acting.action}
          admin={acting.admin}
          onClose={() => setActing({ ...acting, open: false })}
          onEmailFailed={setUnsent}
        />
      ) : null}
    </section>
  );
}

// One Admin: the name, where they stand, the email address, a sentence on
// what comes next, and the steps a Super User can take.
function AdminRow({
  admin,
  now,
  onAct,
}: {
  admin: Admin;
  now: number;
  onAct: (action: AdminAction) => void;
}) {
  const state = adminState(admin, now);
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">{admin.fullName}</span>
          <span className={`${TAG} ${ADMIN_STATE_STYLES[state]}`}>
            {ADMIN_STATE_NAMES[state]}
          </span>
        </p>
        <p className="text-sm break-all text-ink-muted">{admin.email}</p>
        <p className="mt-1 text-sm">{adminDetail(admin, now)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {ACTIONS[state].map(({ action, label }) => (
          <Button
            key={action}
            size="sm"
            variant={
              action === 'disable' || action === 'remove'
                ? 'ghost'
                : 'secondary'
            }
            onClick={() => onAct(action)}
          >
            {label}
            <span className="sr-only"> for {admin.fullName}</span>
          </Button>
        ))}
        {/* Their part of the audit log. */}
        <Link
          to={`/audit-log?actor=${admin.id}`}
          className={buttonClass('ghost', 'sm')}
        >
          What they did
          <span className="sr-only">: {admin.fullName}</span>
        </Link>
      </div>
    </div>
  );
}
