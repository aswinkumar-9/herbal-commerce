import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { z } from 'zod';
import { ApiError } from '../api/api-error';
import { fieldProblems, problemMessage } from '../api/problems';
import { Button } from '../components/Button';
import { Dialog, DialogActions } from '../components/Dialog';
import { Field } from '../components/Field';
import { useToasts } from '../components/toast-context';
import { Problem } from '../orders/OrderDialogs';
import {
  inviteAdmin,
  removeAdmin,
  resendInvitation,
  resetAuthenticator,
  setAdminStatus,
} from './admins-api';
import type { Admin, InviteFields } from './admins-api';
import { adminChanged, adminKeys, adminsChanged } from './admins-queries';

// The dialogs that change an Admin (ADR 0038): inviting one, and each step
// after, saying what happens before it does. Only one change at a time.

const CHANGING = ['admin-change'] as const;
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;

function useChanging(): boolean {
  return useIsMutating({ mutationKey: CHANGING }) > 0;
}

// An email that could not be sent: the page keeps saying so until the
// Super User has read it, as it needs doing again.
export type OnEmailFailed = (message: string) => void;

type InviteField = keyof InviteFields;
const INVITE_FIELDS: InviteField[] = ['fullName', 'email'];
const anEmail = z.email();

// The same checks as the API, so most mistakes are caught before sending.
function checkInvite(values: InviteFields) {
  const errors: Partial<Record<InviteField, string>> = {};
  if (!values.fullName.trim()) {
    errors.fullName = 'Enter their name';
  }
  if (!values.email.trim()) {
    errors.email = 'Enter their email address';
  } else if (!anEmail.safeParse(values.email.trim()).success) {
    errors.email = 'Enter an email address like name@example.com';
  }
  return errors;
}

export function InviteDialog({
  open,
  onClose,
  onEmailFailed,
}: {
  open: boolean;
  onClose: () => void;
  onEmailFailed: OnEmailFailed;
}) {
  const busy = useChanging();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={busy}
      size="md"
      title="Invite an Admin"
      description={
        <p>
          They get an email with a link to choose their own password and set up
          an authenticator app on their phone. The link works once, for 72
          hours.
        </p>
      }
    >
      <InviteForm onDone={onClose} onEmailFailed={onEmailFailed} />
    </Dialog>
  );
}

function InviteForm({
  onDone,
  onEmailFailed,
}: {
  onDone: () => void;
  onEmailFailed: OnEmailFailed;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [values, setValues] = useState<InviteFields>({
    fullName: '',
    email: '',
  });
  const [errors, setErrors] = useState<Partial<Record<InviteField, string>>>(
    {},
  );
  const [problem, setProblem] = useState<string | null>(null);
  const boxes = useRef<Partial<Record<InviteField, HTMLInputElement | null>>>(
    {},
  );
  const focusFirst = (found: Partial<Record<InviteField, string>>) => {
    const first = INVITE_FIELDS.find((name) => found[name]);
    if (first) {
      boxes.current[first]?.focus();
    }
  };

  const send = useMutation({
    mutationKey: CHANGING,
    mutationFn: inviteAdmin,
    onSuccess: (invited) => {
      adminsChanged(queryClient);
      if (invited.invitationSent) {
        toasts.show(`Invitation sent to ${invited.email}`);
      } else {
        onEmailFailed(
          `${invited.fullName} is added, but the invitation to ${invited.email} could not be emailed. Send it again from their row.`,
        );
      }
      onDone();
    },
    onError: (error) => {
      const fields = fieldProblems(error);
      const shown: Partial<Record<InviteField, string>> = {};
      for (const name of INVITE_FIELDS) {
        if (fields[name]) {
          shown[name] = fields[name];
        }
      }
      // The address belongs to someone already: a customer or staff.
      if (error instanceof ApiError && error.status === 409) {
        shown.email = error.message;
      }
      setErrors(shown);
      setProblem(Object.keys(shown).length > 0 ? null : problemMessage(error));
      focusFirst(shown);
    },
  });

  function set(name: InviteField, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    if (errors[name]) {
      setErrors((current) => ({ ...current, [name]: undefined }));
    }
    setProblem(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (send.isPending) {
      return;
    }
    const found = checkInvite(values);
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    send.mutate({
      fullName: values.fullName.trim(),
      email: values.email.trim().toLowerCase(),
    });
  }

  return (
    <form noValidate onSubmit={submit} className="mt-5 space-y-5">
      {problem ? <Problem>{problem}</Problem> : null}
      <Field
        ref={(element) => {
          boxes.current.fullName = element;
        }}
        label="Full name"
        value={values.fullName}
        onChange={(event) => set('fullName', event.target.value)}
        maxLength={NAME_MAX}
        autoComplete="off"
        hint="As they want to be addressed in the email."
        error={errors.fullName}
      />
      <Field
        ref={(element) => {
          boxes.current.email = element;
        }}
        label="Email address"
        type="email"
        inputMode="email"
        value={values.email}
        onChange={(event) => set('email', event.target.value)}
        maxLength={EMAIL_MAX}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        hint="Their own work address. It can’t be one a customer already uses."
        error={errors.email}
      />
      <DialogActions>
        <Button onClick={onDone} disabled={send.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          busy={send.isPending}
          busyLabel="Sending…"
        >
          Send the invitation
        </Button>
      </DialogActions>
    </form>
  );
}

export type AdminAction = 'resend' | 'reset' | 'disable' | 'enable' | 'remove';

interface ActionWords {
  title: string;
  points: ReactNode[];
  confirm: string;
  busyLabel: string;
  keep: string;
  tone: 'default' | 'danger';
}

// What each step says before it is taken.
function wordsFor(action: AdminAction, admin: Admin): ActionWords {
  const name = admin.fullName;
  switch (action) {
    case 'resend':
      return {
        title: `Send ${name} the invitation again?`,
        points: [
          `A new email goes to ${admin.email}, with a link that works once, for 72 hours.`,
          'The link in any earlier email stops working.',
        ],
        confirm: 'Send it again',
        busyLabel: 'Sending…',
        keep: 'Not now',
        tone: 'default',
      };
    case 'reset':
      return {
        title: `Reset ${name}’s authenticator app?`,
        points: [
          'Only when they have lost their phone, or someone else may have it.',
          'The app on that phone stops working at once, and they are signed out everywhere.',
          `A new email goes to ${admin.email}, with a link to set up the app again with their own password. It works once, for 72 hours.`,
        ],
        confirm: 'Reset the app',
        busyLabel: 'Resetting…',
        keep: 'Keep it',
        tone: 'danger',
      };
    case 'disable':
      return {
        title: `Disable ${name}?`,
        points: [
          'They are signed out everywhere at once, and can’t sign in until a Super User enables them again.',
          'Nothing they did is undone.',
        ],
        confirm: 'Disable',
        busyLabel: 'Disabling…',
        keep: 'Keep them active',
        tone: 'danger',
      };
    case 'enable':
      return {
        title: `Enable ${name}?`,
        points: [
          admin.invitationAcceptedAt === null
            ? 'They can accept the invitation again: send it from their row.'
            : 'They can sign in again with their password and authenticator app.',
        ],
        confirm: 'Enable',
        busyLabel: 'Enabling…',
        keep: 'Not now',
        tone: 'default',
      };
    case 'remove':
      return {
        title: `Remove ${name}?`,
        points: [
          admin.invitationAcceptedAt === null
            ? 'Their invitation link stops working, and the account goes for good.'
            : 'Their account goes for good. To let them back, invite them again.',
          'The audit log keeps everything they did.',
        ],
        confirm: `Remove ${name}`,
        busyLabel: 'Removing…',
        keep: 'Keep them',
        tone: 'danger',
      };
  }
}

// One step for one Admin, once the Super User has read what it does.
export function AdminActionDialog({
  open,
  action,
  admin,
  onClose,
  onEmailFailed,
}: {
  open: boolean;
  action: AdminAction;
  admin: Admin;
  onClose: () => void;
  onEmailFailed: OnEmailFailed;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [problem, setProblem] = useState<string | null>(null);
  const words = wordsFor(action, admin);

  const save = useMutation({
    mutationKey: CHANGING,
    mutationFn: async (): Promise<() => void> => {
      switch (action) {
        case 'resend': {
          const invited = await resendInvitation(admin.id);
          return () => {
            adminsChanged(queryClient);
            if (invited.invitationSent) {
              toasts.show(`Invitation sent again to ${invited.email}`);
            } else {
              onEmailFailed(
                `The invitation to ${invited.email} could not be emailed. Send it again.`,
              );
            }
          };
        }
        case 'reset': {
          const reset = await resetAuthenticator(admin.id);
          return () => {
            adminsChanged(queryClient);
            if (reset.emailSent) {
              toasts.show(
                `${reset.fullName}’s authenticator app is reset. The link is on its way.`,
              );
            } else {
              onEmailFailed(
                `${reset.fullName}’s authenticator app is reset, but the email with the link could not be sent. Send a new link from their row.`,
              );
            }
          };
        }
        case 'disable':
        case 'enable': {
          const saved = await setAdminStatus(
            admin.id,
            action === 'disable' ? 'DISABLED' : 'ACTIVE',
          );
          return () => {
            adminChanged(queryClient, saved);
            toasts.show(
              `${saved.fullName} ${action === 'disable' ? 'disabled' : 'enabled'}`,
            );
          };
        }
        case 'remove': {
          await removeAdmin(admin.id);
          return () => {
            queryClient.setQueryData<Admin[]>(adminKeys.list(), (admins) =>
              admins?.filter((each) => each.id !== admin.id),
            );
            adminsChanged(queryClient);
            toasts.show(`${admin.fullName} removed`);
          };
        }
      }
    },
    onSuccess: (done) => {
      done();
      setProblem(null);
      onClose();
    },
    onError: (error) => {
      // Someone else changed or removed the Admin meanwhile: the list is
      // read again, and the dialog says why.
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 409)
      ) {
        adminsChanged(queryClient);
      }
      setProblem(problemMessage(error));
    },
  });

  const close = () => {
    setProblem(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      locked={save.isPending}
      tone={words.tone}
      title={words.title}
      description={
        <ul className="list-disc space-y-1.5 pl-5">
          {words.points.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      }
      actions={
        <>
          <Button onClick={close} disabled={save.isPending}>
            {words.keep}
          </Button>
          <Button
            variant={words.tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => save.mutate()}
            busy={save.isPending}
            busyLabel={words.busyLabel}
          >
            {words.confirm}
          </Button>
        </>
      }
    >
      {problem ? (
        <div className="mt-4">
          <Problem>{problem}</Problem>
        </div>
      ) : null}
    </Dialog>
  );
}
