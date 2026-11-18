import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiError } from '../api/api-error';
import { fieldProblems, problemMessage } from '../api/problems';
import { Button } from '../components/Button';
import { Dialog, DialogActions } from '../components/Dialog';
import { Field, TextAreaField } from '../components/Field';
import { useToasts } from '../components/toast-context';
import {
  BATCH_NUMBER_MAX,
  BATCH_NUMBER_TAKEN,
  LABEL_FIELDS,
  NEW_DELIVERY,
  NOTE_MAX,
  RECEIVE_FIELDS,
  batchState,
  checkChange,
  checkCount,
  checkLabel,
  checkReceive,
  countHint,
  expiryHint,
  labelChanges,
  labelValues,
  toBatchFields,
  toCount,
  toMovement,
  todayInIndia,
} from './batch-forms';
import type {
  ChangeErrors,
  ChangeKind,
  ChangeValues,
  CountErrors,
  CountValues,
  LabelErrors,
  LabelField,
  LabelValues,
  ReceiveErrors,
  ReceiveField,
  ReceiveValues,
} from './batch-forms';
import {
  addMovement,
  countBatch,
  receiveBatch,
  updateBatch,
} from './stock-api';
import type {
  Batch,
  BatchFields,
  BatchLabel,
  CountFields,
  MovementFields,
} from './stock-api';
import { packs } from './stock-display';
import { stockChanged, stockKeys } from './stock-queries';
import { useNow } from './use-now';

// The dialogs that change a pack size's batches (ADR 0024, 0034): a new
// delivery, a label put right, packs added or written off, and a count.
// Each checks what staff typed first, then the API checks it again.

const SAVING = ['batch-change'] as const;

function useSaving(): boolean {
  return useIsMutating({ mutationKey: SAVING }) > 0;
}

// The boxes of a form by field, so the first one with a mistake can take
// the focus.
function useBoxes<F extends string>(order: readonly F[]) {
  const boxes = useRef<Partial<Record<F, HTMLElement | null>>>({});
  return {
    box: (name: F) => (element: HTMLElement | null) => {
      boxes.current[name] = element;
    },
    focus: (name: F) => boxes.current[name]?.focus(),
    focusFirst: (errors: Partial<Record<F, string>>) => {
      const first = order.find((name) => errors[name]);
      if (first) {
        boxes.current[first]?.focus();
      }
    },
  };
}

// The API's words for each field it refused, for the fields of this form.
function refused<F extends string>(
  error: unknown,
  order: readonly F[],
): Partial<Record<F, string>> {
  const fields = fieldProblems(error);
  const shown: Partial<Record<F, string>> = {};
  for (const name of order) {
    if (fields[name]) {
      shown[name] = fields[name];
    }
  }
  return shown;
}

const numberTaken = (error: unknown) =>
  error instanceof ApiError &&
  error.status === 409 &&
  error.message === BATCH_NUMBER_TAKEN;

function Problem({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      {children}
    </p>
  );
}

function Actions({
  busy,
  submit,
  onCancel,
}: {
  busy: boolean;
  submit: string;
  onCancel: () => void;
}) {
  return (
    <DialogActions>
      <Button onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" busy={busy} busyLabel="Saving…">
        {submit}
      </Button>
    </DialogActions>
  );
}

// The label's fields: its number and its dates.
function LabelBoxes({
  values,
  errors,
  set,
  box,
}: {
  values: LabelValues;
  errors: Partial<Record<LabelField, string>>;
  set: (key: LabelField, value: string) => void;
  box: (name: LabelField) => (element: HTMLElement | null) => void;
}) {
  const now = useNow();
  const today = todayInIndia(now);
  return (
    <>
      <Field
        ref={box('batchNumber')}
        label="Batch number"
        value={values.batchNumber}
        onChange={(event) => set('batchNumber', event.target.value)}
        maxLength={BATCH_NUMBER_MAX + 10}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        hint="As printed on the pack. Saved in capitals, without spaces."
        error={errors.batchNumber}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          ref={box('manufacturedOn')}
          label="Manufactured on"
          type="date"
          value={values.manufacturedOn}
          onChange={(event) => set('manufacturedOn', event.target.value)}
          max={today}
          error={errors.manufacturedOn}
        />
        <Field
          ref={box('expiresOn')}
          label="Expires on"
          type="date"
          value={values.expiresOn}
          onChange={(event) => set('expiresOn', event.target.value)}
          hint={expiryHint(values.expiresOn, now)}
          error={errors.expiresOn}
        />
      </div>
    </>
  );
}

// A form's values, and clearing a field's mark once it is changed. A new
// manufacturing date clears the expiry's mark too, as one is checked
// against the other.
function useValues<V extends object, F extends string>(start: V) {
  const [values, setValues] = useState(start);
  const [errors, setErrors] = useState<Partial<Record<F, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  function set<K extends keyof V>(key: K, value: V[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    const cleared = (
      key === 'manufacturedOn' ? ['manufacturedOn', 'expiresOn'] : [key]
    ) as F[];
    if (cleared.some((name) => errors[name])) {
      setErrors((current) => {
        const next = { ...current };
        for (const name of cleared) {
          delete next[name];
        }
        return next;
      });
    }
    setProblem(null);
  }
  return { values, set, errors, setErrors, problem, setProblem };
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
}

// A delivery of the pack size: a new batch, with its label and packs.
export function ReceiveDialog({
  open,
  onClose,
  variantId,
  packLabel,
}: DialogProps & { variantId: string; packLabel: string }) {
  const busy = useSaving();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={busy}
      size="md"
      title="Receive a delivery"
      description={<p>A new batch of {packLabel}, as its label says.</p>}
    >
      <ReceiveForm variantId={variantId} onDone={onClose} />
    </Dialog>
  );
}

function ReceiveForm({
  variantId,
  onDone,
}: {
  variantId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const form = useValues<ReceiveValues, ReceiveField>(NEW_DELIVERY);
  const { box, focusFirst } = useBoxes(RECEIVE_FIELDS);

  const save = useMutation({
    mutationKey: SAVING,
    mutationFn: (input: BatchFields) => receiveBatch(variantId, input),
    onSuccess: (saved) => {
      stockChanged(queryClient, saved);
      toasts.show(
        `Batch ${saved.batchNumber} received: ${packs(saved.quantity)}`,
      );
      onDone();
    },
    onError: (error) => {
      const shown: ReceiveErrors = refused(error, RECEIVE_FIELDS);
      if (numberTaken(error)) {
        shown.batchNumber = BATCH_NUMBER_TAKEN;
      }
      form.setErrors(shown);
      form.setProblem(
        Object.keys(shown).length > 0 ? null : problemMessage(error),
      );
      focusFirst(shown);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) {
      return;
    }
    const found = checkReceive(form.values, new Date());
    form.setErrors(found);
    form.setProblem(null);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    save.mutate(toBatchFields(form.values));
  }

  return (
    <form noValidate onSubmit={submit} className="mt-5 space-y-5">
      {form.problem ? <Problem>{form.problem}</Problem> : null}
      <LabelBoxes
        values={form.values}
        errors={form.errors}
        set={form.set}
        box={box}
      />
      <Field
        ref={box('quantity')}
        label="Packs received"
        value={form.values.quantity}
        onChange={(event) => form.set('quantity', event.target.value)}
        inputMode="numeric"
        maxLength={9}
        autoComplete="off"
        hint="How many packs came in this batch."
        error={form.errors.quantity}
      />
      <TextAreaField
        ref={box('note')}
        label="Note (optional)"
        value={form.values.note}
        onChange={(event) => form.set('note', event.target.value)}
        maxLength={NOTE_MAX}
        rows={2}
        hint="Such as the supplier's invoice number."
        error={form.errors.note}
      />
      <Actions busy={save.isPending} submit="Receive" onCancel={onDone} />
    </form>
  );
}

// A batch's label put right: its number or its dates. Its stock does not
// change.
export function LabelDialog({
  open,
  onClose,
  batch,
}: DialogProps & { batch: Batch | null }) {
  const busy = useSaving();
  return (
    <Dialog
      open={open && batch !== null}
      onClose={onClose}
      locked={busy}
      size="md"
      title={`Correct batch ${batch?.batchNumber ?? ''}`}
      description={
        <p>Put the label's details right. The stock does not change.</p>
      }
    >
      {batch ? <LabelForm batch={batch} onDone={onClose} /> : null}
    </Dialog>
  );
}

function LabelForm({ batch, onDone }: { batch: Batch; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const form = useValues<LabelValues, LabelField>(labelValues(batch));
  const { box, focusFirst } = useBoxes(LABEL_FIELDS);

  const save = useMutation({
    mutationKey: SAVING,
    mutationFn: (changes: BatchLabel) => updateBatch(batch.id, changes),
    onSuccess: (saved) => {
      stockChanged(queryClient, saved);
      toasts.show(`Batch ${saved.batchNumber} corrected`);
      onDone();
    },
    onError: (error) => {
      const shown: LabelErrors = refused(error, LABEL_FIELDS);
      if (numberTaken(error)) {
        shown.batchNumber = BATCH_NUMBER_TAKEN;
      }
      form.setErrors(shown);
      form.setProblem(
        Object.keys(shown).length > 0 ? null : problemMessage(error),
      );
      focusFirst(shown);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) {
      return;
    }
    const found = checkLabel(form.values, new Date());
    form.setErrors(found);
    form.setProblem(null);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    const changes = labelChanges(form.values, batch);
    if (Object.keys(changes).length === 0) {
      onDone();
      return;
    }
    save.mutate(changes);
  }

  return (
    <form noValidate onSubmit={submit} className="mt-5 space-y-5">
      {form.problem ? <Problem>{form.problem}</Problem> : null}
      <LabelBoxes
        values={form.values}
        errors={form.errors}
        set={form.set}
        box={box}
      />
      <Actions busy={save.isPending} submit="Save changes" onCancel={onDone} />
    </form>
  );
}

const CHANGE_FIELDS = ['packs', 'note'] as const;

const KINDS: { kind: ChangeKind; label: string; hint: string }[] = [
  {
    kind: 'DAMAGED',
    label: 'Damaged or lost',
    hint: 'Broken, spoiled or missing packs: written off.',
  },
  {
    kind: 'EXPIRED',
    label: 'Expired',
    hint: 'Packs past or too near their expiry: written off.',
  },
  {
    kind: 'RECEIVED',
    label: 'More arrived',
    hint: 'More packs of this same batch: added to it.',
  },
];

// More packs of a batch, or packs written off.
export function ChangeDialog({
  open,
  onClose,
  batch,
}: DialogProps & { batch: Batch | null }) {
  const busy = useSaving();
  return (
    <Dialog
      open={open && batch !== null}
      onClose={onClose}
      locked={busy}
      size="md"
      title={`Change the stock of batch ${batch?.batchNumber ?? ''}`}
      description={
        <p>
          For a count of the shelf, use Count instead: it works out the
          difference.
        </p>
      }
    >
      {batch ? <ChangeForm batch={batch} onDone={onClose} /> : null}
    </Dialog>
  );
}

function ChangeForm({ batch, onDone }: { batch: Batch; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const now = useNow();
  const expired = batchState(batch, now) === 'expired';
  const form = useValues<ChangeValues, (typeof CHANGE_FIELDS)[number]>({
    kind: expired ? 'EXPIRED' : 'DAMAGED',
    packs: '',
    note: '',
  });
  const { box, focusFirst } = useBoxes(CHANGE_FIELDS);
  // More of a batch that has expired cannot be received.
  const kinds = KINDS.filter(({ kind }) => !(expired && kind === 'RECEIVED'));
  const adding = form.values.kind === 'RECEIVED';

  const save = useMutation({
    mutationKey: SAVING,
    mutationFn: (input: MovementFields) => addMovement(batch.id, input),
    onSuccess: (saved, input) => {
      stockChanged(queryClient, saved);
      const count = packs(Math.abs(input.change));
      toasts.show(
        input.change > 0
          ? `${count} added to batch ${saved.batchNumber}`
          : `${count} written off from batch ${saved.batchNumber}`,
      );
      onDone();
    },
    onError: (error) => {
      const shown: ChangeErrors = refused(error, CHANGE_FIELDS);
      form.setErrors(shown);
      form.setProblem(
        Object.keys(shown).length > 0 ? null : problemMessage(error),
      );
      focusFirst(shown);
      // The batch may have changed meanwhile: show it as it is now.
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) {
      return;
    }
    const found = checkChange(form.values, batch);
    form.setErrors(found);
    form.setProblem(null);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    save.mutate(toMovement(form.values));
  }

  return (
    <form noValidate onSubmit={submit} className="mt-5 space-y-5">
      {form.problem ? <Problem>{form.problem}</Problem> : null}
      <fieldset>
        <legend className="text-sm font-medium">What happened</legend>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
          {kinds.map(({ kind, label, hint }) => (
            <label
              key={kind}
              className={`flex cursor-pointer flex-col gap-0.5 rounded-control border p-3 text-sm transition-[background-color,border-color,box-shadow] duration-150 has-focus-visible:ring-2 has-focus-visible:ring-primary ${
                form.values.kind === kind
                  ? 'border-primary bg-primary-soft inset-shadow-pressed'
                  : 'border-line bg-surface shadow-clay-sm inset-shadow-clay hover:bg-surface-muted'
              }`}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="kind"
                  value={kind}
                  checked={form.values.kind === kind}
                  onChange={() => form.set('kind', kind)}
                  className="accent-primary"
                />
                {label}
              </span>
              <span className="text-xs text-ink-muted">{hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        ref={box('packs')}
        label={adding ? 'Packs added' : 'Packs written off'}
        value={form.values.packs}
        onChange={(event) => form.set('packs', event.target.value)}
        inputMode="numeric"
        maxLength={9}
        autoComplete="off"
        hint={
          adding
            ? `The batch has ${packs(batch.quantity)} free now.`
            : `From the ${packs(batch.quantity)} free now.`
        }
        error={form.errors.packs}
      />
      <TextAreaField
        ref={box('note')}
        label="Note (optional)"
        value={form.values.note}
        onChange={(event) => form.set('note', event.target.value)}
        maxLength={NOTE_MAX}
        rows={2}
        error={form.errors.note}
      />
      <Actions
        busy={save.isPending}
        submit={adding ? 'Add packs' : 'Write off'}
        onCancel={onDone}
      />
    </form>
  );
}

const COUNT_FIELDS = ['counted', 'note'] as const;

// A count of a batch's shelf: staff type what they found, and the API
// puts the difference right. If an order takes or gives back packs while
// they count, the count is not saved.
export function CountDialog({
  open,
  onClose,
  batch,
}: DialogProps & { batch: Batch | null }) {
  const busy = useSaving();
  return (
    <Dialog
      open={open && batch !== null}
      onClose={onClose}
      locked={busy}
      size="md"
      title={`Count batch ${batch?.batchNumber ?? ''}`}
    >
      {batch ? <CountForm batch={batch} onDone={onClose} /> : null}
    </Dialog>
  );
}

function CountForm({ batch, onDone }: { batch: Batch; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const form = useValues<CountValues, (typeof COUNT_FIELDS)[number]>({
    counted: '',
    note: '',
  });
  const { box, focus, focusFirst } = useBoxes(COUNT_FIELDS);
  // What should be on the shelf when staff last checked their count. If
  // the batch changes while they count, the dialog shows the new number at
  // once and says what it was, and the next save only acknowledges it.
  const [seen, setSeen] = useState(batch.onShelf);
  const moved = batch.onShelf !== seen;

  const save = useMutation({
    mutationKey: SAVING,
    mutationFn: (input: CountFields) => countBatch(batch.id, input),
    onSuccess: ({ batch: saved, change }) => {
      stockChanged(queryClient, saved);
      toasts.show(
        change === 0
          ? `Batch ${saved.batchNumber}: the count matches. Nothing changed.`
          : `Batch ${saved.batchNumber} put right: ${packs(Math.abs(change))} ${
              change > 0 ? 'more' : 'fewer'
            }`,
      );
      onDone();
    },
    onError: (error) => {
      const shown: CountErrors = refused(error, COUNT_FIELDS);
      form.setErrors(shown);
      form.setProblem(
        Object.keys(shown).length > 0 ? null : problemMessage(error),
      );
      focusFirst(shown);
      // An order took or gave back packs: read the batch again.
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) {
      return;
    }
    if (moved) {
      setSeen(batch.onShelf);
      form.setProblem(null);
      focus('counted');
      return;
    }
    const found = checkCount(form.values, batch, seen);
    form.setErrors(found);
    form.setProblem(null);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    save.mutate(toCount(form.values, seen));
  }

  return (
    <form noValidate onSubmit={submit} className="mt-5 space-y-5">
      {form.problem && !moved ? <Problem>{form.problem}</Problem> : null}
      {moved ? (
        <Problem>
          The stock changed while you were counting: {packs(batch.onShelf)}{' '}
          should now be on the shelf, not {packs(seen)}. Check your count, then
          save it again.
        </Problem>
      ) : null}
      <div className="rounded-lg bg-surface-muted px-4 py-3 text-sm inset-shadow-well">
        <p>
          Should be on the shelf:{' '}
          <strong className="text-base">{packs(batch.onShelf)}</strong>
        </p>
        <p className="mt-0.5 text-ink-muted">
          {packs(batch.quantity)} free
          {batch.awaitingPacking > 0
            ? ` and ${packs(batch.awaitingPacking)} for orders not yet packed`
            : ''}
          .{' '}
          {batch.packed > 0
            ? `Leave out the ${packs(batch.packed)} already packed in boxes.`
            : 'Packed orders are in their boxes: leave them out.'}
        </p>
      </div>
      <Field
        ref={box('counted')}
        label="Packs counted"
        value={form.values.counted}
        onChange={(event) => form.set('counted', event.target.value)}
        inputMode="numeric"
        maxLength={9}
        autoComplete="off"
        hint={countHint(form.values, batch.onShelf)}
        error={form.errors.counted}
      />
      <TextAreaField
        ref={box('note')}
        label="Why it differs"
        value={form.values.note}
        onChange={(event) => form.set('note', event.target.value)}
        maxLength={NOTE_MAX}
        rows={2}
        hint="Needed when the count differs, such as “2 found broken”."
        error={form.errors.note}
      />
      <Actions
        busy={save.isPending}
        submit="Save the count"
        onCancel={onDone}
      />
    </form>
  );
}
