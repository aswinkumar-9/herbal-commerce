import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HandCoins } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../api/api-error';
import { fieldProblems, problemMessage } from '../api/problems';
import { rupees } from '../catalog/products/pack-size-form';
import { Button } from '../components/Button';
import { Dialog, DialogActions } from '../components/Dialog';
import { TextAreaField } from '../components/Field';
import { useToasts } from '../components/toast-context';
import { momentName } from '../stock/stock-display';
import {
  GIVEN_BACK_NOTE_MAX,
  GIVEN_BACK_NOTE_PROBLEM,
  givenBackNote,
} from './order-display';
import { giveBackByHand } from './orders-api';
import type { Refund } from './orders-api';
import { orderKeys, refundGivenBack } from './orders-queries';
import { Problem } from './OrderDialogs';

// A refund Razorpay could not give back, which a Super User gave back
// another way (ADR 0038): in the Razorpay dashboard, or by a bank transfer.
// They mark it here once, saying how. The customer gets no email: whoever
// gave the money back tells them.

interface Marking {
  refund: Refund;
  orderReference: string;
}

// One dialog for the page, not one for each refund: when the lists are read
// again (every minute, or after a refusal) and a refund leaves them, its
// dialog stays open, with what the Super User typed and why it was refused.
export function useGiveBack() {
  const [marking, setMarking] = useState<
    (Marking & { opening: number }) | null
  >(null);
  const [open, setOpen] = useState(false);
  const mark = useCallback((refund: Refund, orderReference: string) => {
    // Each opening starts with an empty note.
    setMarking((last) => ({
      refund,
      orderReference,
      opening: (last?.opening ?? 0) + 1,
    }));
    setOpen(true);
  }, []);
  const dialog = marking ? (
    <GiveBackDialog
      key={marking.opening}
      open={open}
      refund={marking.refund}
      orderReference={marking.orderReference}
      onClose={() => setOpen(false)}
    />
  ) : null;
  return { mark, dialog };
}

export type MarkGivenBack = ReturnType<typeof useGiveBack>['mark'];

export function GiveBackButton({
  refund,
  orderReference,
  onMark,
}: Marking & { onMark: MarkGivenBack }) {
  return (
    <Button
      icon={HandCoins}
      // Several may be listed: the name says which.
      aria-label={`Mark as given back by hand: ${rupees(refund.amountRupees)} for order ${orderReference}`}
      onClick={() => onMark(refund, orderReference)}
    >
      Mark as given back by hand
    </Button>
  );
}

function GiveBackDialog({
  open,
  refund,
  orderReference,
  onClose,
}: Marking & { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const save = useMutation({
    mutationFn: (sent: string) => giveBackByHand(refund.id, sent),
    onSuccess: (saved) => {
      refundGivenBack(queryClient, saved);
      toasts.show(
        `${rupees(saved.amountRupees)} for ${saved.orderReference} marked as given back`,
      );
      onClose();
    },
    onError: (failure) => {
      const fields = fieldProblems(failure);
      if (fields.note) {
        setError(fields.note);
        box.current?.focus();
        return;
      }
      // Marked by someone else meanwhile, or gone: read them again.
      if (
        failure instanceof ApiError &&
        (failure.status === 404 || failure.status === 409)
      ) {
        void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      }
      setProblem(problemMessage(failure));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) {
      return;
    }
    setProblem(null);
    const sent = givenBackNote(note);
    if (sent === undefined) {
      setError(GIVEN_BACK_NOTE_PROBLEM);
      box.current?.focus();
      return;
    }
    setError(undefined);
    save.mutate(sent);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={save.isPending}
      size="md"
      title={`Mark ${rupees(refund.amountRupees)} for ${orderReference} as given back?`}
      description={
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Only once the customer has the money: given back in the Razorpay
            dashboard, or another way, such as a bank transfer.
          </li>
          <li>The customer gets no email from the shop: tell them yourself.</li>
          <li>It can’t be undone.</li>
        </ul>
      }
    >
      <form noValidate onSubmit={submit} className="mt-5 space-y-5">
        {problem ? <Problem>{problem}</Problem> : null}
        <TextAreaField
          ref={box}
          label="How it was given back"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setError(undefined);
            setProblem(null);
          }}
          rows={3}
          maxLength={GIVEN_BACK_NOTE_MAX}
          hint="Such as the new Razorpay refund ID, or the bank transfer’s UTR, and the day. Only Super Users see it."
          error={error}
        />
        <DialogActions>
          <Button onClick={onClose} disabled={save.isPending}>
            Not yet
          </Button>
          <Button
            type="submit"
            variant="primary"
            busy={save.isPending}
            busyLabel="Saving…"
          >
            Mark as given back
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// Who gave a failed refund back by hand, when, and how.
export function GivenBack({ refund }: { refund: Refund }) {
  if (!refund.givenBackAt) {
    return null;
  }
  return (
    <div className="mt-2 rounded-lg bg-primary-soft/50 px-3 py-2 text-sm">
      <p>
        Given back by hand by {refund.givenBackBy?.fullName ?? 'a Super User'},{' '}
        {momentName(refund.givenBackAt)}:
      </p>
      <blockquote className="mt-1 break-words whitespace-pre-line text-ink">
        {refund.givenBackNote}
      </blockquote>
    </div>
  );
}
