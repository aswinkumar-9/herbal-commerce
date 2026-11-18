import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../../api/api-error';
import { fieldProblems, problemMessage } from '../../api/problems';
import { Button } from '../../components/Button';
import { Dialog, DialogActions } from '../../components/Dialog';
import { Field, SelectField } from '../../components/Field';
import { Switch } from '../../components/Switch';
import { useToasts } from '../../components/toast-context';
import { useUnsavedPart } from '../../components/unsaved-changes';
import { stockKeys } from '../../stock/stock-queries';
import {
  PACK_UNITS,
  PACK_UNIT_NAMES,
  createVariant,
  updateVariant,
} from '../catalog-api';
import type { PackUnit, Variant, VariantFields } from '../catalog-api';
import { catalogKeys, putVariant } from '../catalog-queries';
import {
  PACK_FIELDS,
  SIZE_TAKEN,
  SKU_MAX,
  SKU_TAKEN,
  changes,
  check,
  lowStockHint,
  packName,
  priceHint,
  startingValues,
  toFields,
} from './pack-size-form';
import type { PackErrors, PackField, PackValues } from './pack-size-form';

const SAVING = ['pack-size-form'] as const;

interface EditorProps {
  open: boolean;
  productId: string;
  // null: a new pack size.
  variant: Variant | null;
  // Where a new pack size goes: after the last one.
  nextPosition: number;
  onClose: () => void;
}

// Adds a pack size to a product or changes one, in a dialog over its page.
export function PackSizeEditor({
  open,
  productId,
  variant,
  nextPosition,
  onClose,
}: EditorProps) {
  const saving = useIsMutating({ mutationKey: SAVING }) > 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={saving}
      size="md"
      title={variant ? `Edit ${packName(variant)}` : 'New pack size'}
    >
      <PackSizeForm
        productId={productId}
        variant={variant}
        nextPosition={nextPosition}
        onDone={onClose}
      />
    </Dialog>
  );
}

// The field a clash belongs to: the API says which in words only.
function clashField(error: unknown): PackField | null {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return null;
  }
  return error.message === SKU_TAKEN
    ? 'sku'
    : error.message === SIZE_TAKEN
      ? 'quantity'
      : null;
}

function PackSizeForm({
  productId,
  variant,
  nextPosition,
  onDone,
}: {
  productId: string;
  variant: Variant | null;
  nextPosition: number;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [initial] = useState(() => startingValues(variant));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<PackErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const boxes = useRef<Partial<Record<PackField, HTMLElement | null>>>({});

  const dirty = (Object.keys(initial) as (keyof PackValues)[]).some(
    (key) => values[key] !== initial[key],
  );
  // Leaving the page asks first (the page's guard does it).
  useUnsavedPart(dirty);

  const save = useMutation({
    mutationKey: SAVING,
    mutationFn: (input: Partial<VariantFields> & { position?: number }) =>
      variant
        ? updateVariant(variant.id, input)
        : createVariant(
            productId,
            input as VariantFields & { position: number },
          ),
    onSuccess: (saved) => {
      // The Stock page shows its SKU, whether it is on sale and when it is
      // low.
      void queryClient.invalidateQueries({ queryKey: stockKeys.all });
      if (variant) {
        putVariant(queryClient, saved);
        toasts.show(`${packName(saved)} saved`);
      } else {
        void queryClient.invalidateQueries({
          queryKey: catalogKeys.variants(productId),
        });
        toasts.show(`${packName(saved)} added`);
      }
      onDone();
    },
    onError: (error) => {
      const fields = fieldProblems(error);
      const shown: PackErrors = {};
      for (const name of PACK_FIELDS) {
        if (fields[name]) {
          shown[name] = fields[name];
        }
      }
      const clash = clashField(error);
      if (clash && error instanceof Error) {
        shown[clash] = error.message;
      }
      setErrors(shown);
      setProblem(Object.keys(shown).length > 0 ? null : problemMessage(error));
      focusFirst(shown);
    },
  });

  function focusFirst(found: PackErrors) {
    const first = PACK_FIELDS.find((name) => found[name]);
    if (first) {
      boxes.current[first]?.focus();
    }
  }

  function box(name: PackField) {
    return (element: HTMLElement | null) => {
      boxes.current[name] = element;
    };
  }

  function set<K extends keyof PackValues>(key: K, value: PackValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    // A change clears its mark; a new MRP clears the price's too, as the
    // price is checked against it.
    const cleared: PackField[] =
      key === 'mrpRupees'
        ? ['mrpRupees', 'priceRupees']
        : key === 'unit'
          ? ['unit', 'quantity']
          : key === 'isActive'
            ? []
            : [key as PackField];
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

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) {
      return;
    }
    const found = check(values);
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    if (variant) {
      const changed = changes(values, variant);
      if (Object.keys(changed).length === 0) {
        onDone();
        return;
      }
      save.mutate(changed);
      return;
    }
    save.mutate({ ...toFields(values), position: nextPosition });
  }

  return (
    <form noValidate onSubmit={submit} className="mt-5 space-y-5">
      {problem ? (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {problem}
        </p>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          ref={box('quantity')}
          label="Quantity"
          value={values.quantity}
          onChange={(event) => set('quantity', event.target.value)}
          inputMode="numeric"
          maxLength={9}
          autoComplete="off"
          hint="The net quantity on the label."
          error={errors.quantity}
        />
        <SelectField
          ref={box('unit')}
          label="Unit"
          value={values.unit}
          onChange={(event) => set('unit', event.target.value as PackUnit | '')}
          error={errors.unit}
        >
          <option value="">Choose a unit</option>
          {PACK_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {PACK_UNIT_NAMES[unit]}
            </option>
          ))}
        </SelectField>
      </div>
      <Field
        ref={box('sku')}
        label="SKU"
        value={values.sku}
        onChange={(event) => set('sku', event.target.value)}
        maxLength={SKU_MAX}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        hint='Your own code for this pack, like "ASH-CAP-60". Saved in capitals.'
        error={errors.sku}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          ref={box('mrpRupees')}
          label="MRP (₹)"
          value={values.mrpRupees}
          onChange={(event) => set('mrpRupees', event.target.value)}
          inputMode="numeric"
          maxLength={11}
          autoComplete="off"
          hint="As printed on the pack, in whole rupees."
          error={errors.mrpRupees}
        />
        <Field
          ref={box('priceRupees')}
          label="Price (₹)"
          value={values.priceRupees}
          onChange={(event) => set('priceRupees', event.target.value)}
          inputMode="numeric"
          maxLength={11}
          autoComplete="off"
          hint={priceHint(values)}
          error={errors.priceRupees}
        />
      </div>
      <Field
        ref={box('lowStockAt')}
        label="Low stock at (packs)"
        value={values.lowStockAt}
        onChange={(event) => set('lowStockAt', event.target.value)}
        inputMode="numeric"
        maxLength={9}
        autoComplete="off"
        hint={lowStockHint(values)}
        error={errors.lowStockAt}
      />
      <Switch
        label="On sale"
        hint="Customers can buy it while the product is live."
        checked={values.isActive}
        onChange={(isActive) => set('isActive', isActive)}
      />
      <DialogActions>
        <Button onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          busy={save.isPending}
          busyLabel="Saving…"
        >
          {variant ? 'Save changes' : 'Add pack size'}
        </Button>
      </DialogActions>
    </form>
  );
}
