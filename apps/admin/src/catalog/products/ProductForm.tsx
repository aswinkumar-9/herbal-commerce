import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { To } from 'react-router';
import { fieldProblems, problemMessage } from '../../api/problems';
import { Button, buttonClass } from '../../components/Button';
import { Field, SelectField, TextAreaField } from '../../components/Field';
import { Switch } from '../../components/Switch';
import { useToasts } from '../../components/toast-context';
import { useUnsavedChanges } from '../../components/unsaved-changes';
import { rise, staggered } from '../../motion';
import {
  GST_RATES,
  PRODUCT_TYPES,
  PRODUCT_TYPE_NAMES,
  createProduct,
  nextProductPosition,
  updateProduct,
} from '../catalog-api';
import type {
  Category,
  Product,
  ProductInput,
  ProductType,
} from '../catalog-api';
import { catalogKeys } from '../catalog-queries';
import { SLUG_MAX, slugify } from '../slug';
import { DeleteProductDialog } from './DeleteProductDialog';
import {
  FIELD_ORDER,
  LIMITS,
  afterSave,
  changes,
  check,
  missingToGoLive,
  newProduct,
  startingValues,
  toFields,
} from './product-form';
import type {
  ProductErrors,
  ProductProblem,
  ProductValues,
} from './product-form';

const SAVING = ['product-form'] as const;
const NEEDS_CHANGES = 'Some details need changing: see the marked fields.';
const NO_IMAGE = 'Add an image first: a live product needs at least one.';

// Which licence the type needs (ADR 0021).
const LICENCE_HINTS: Record<ProductType | '', string> = {
  '': 'As printed on the pack. The type says which licence.',
  AYURVEDIC_MEDICINE: 'The AYUSH licence, as printed on the pack.',
  FOOD_OR_SUPPLEMENT: 'The FSSAI licence: 14 digits.',
  COSMETIC: 'The cosmetics licence, as printed on the pack.',
};

interface FormProps {
  // null: a new product.
  product: Product | null;
  categories: Category[];
  // A new product's category, when the list had one chosen.
  startCategory?: string | undefined;
  // The list's filters as staff left them, to go back to.
  listSearch: string;
  canDelete: boolean;
}

// A product's details, in three parts: what customers read, what the label
// says, and the tax. Staff save them together. A new product starts as a
// draft; going live needs every label and tax detail, and an image.
export function ProductForm({
  product,
  categories,
  startCategory,
  listSearch,
  canDelete,
}: FormProps) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const navigate = useNavigate();
  const [initial, setInitial] = useState(() =>
    startingValues(product, startCategory),
  );
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<ProductErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const boxes = useRef<Partial<Record<ProductProblem, HTMLElement | null>>>({});
  const listPath = { pathname: '/catalog/products', search: listSearch };

  const dirty = (Object.keys(initial) as (keyof ProductValues)[]).some(
    (key) => values[key] !== initial[key],
  );
  const { prompt, allowLeaving } = useUnsavedChanges(dirty);

  const save = useMutation({
    mutationKey: SAVING,
    // A product put into a category goes after its last one.
    mutationFn: async ({
      input,
    }: {
      input: ProductInput;
      sent: ProductValues;
    }) => {
      const body = input.categoryId
        ? { ...input, position: await nextProductPosition(input.categoryId) }
        : input;
      return product ? updateProduct(product.id, body) : createProduct(body);
    },
    onSuccess: (saved, { sent }) => {
      // The lists read it again when they next open.
      queryClient.setQueryData(catalogKeys.product(saved.id), saved);
      if (product) {
        const fresh = startingValues(saved);
        setInitial(fresh);
        setValues((current) => afterSave(current, sent, fresh));
        toasts.show(`${saved.name} saved`);
        return;
      }
      toasts.show(`${saved.name} added`);
      allowLeaving();
      void navigate(`/catalog/products/${saved.id}`, {
        replace: true,
        state: { listSearch },
      });
    },
    onError: (error) => {
      const fields = fieldProblems(error);
      const shown: ProductErrors = {};
      for (const name of FIELD_ORDER) {
        const message = fields[name];
        if (message) {
          shown[name] = name === 'images' ? NO_IMAGE : message;
        }
      }
      setErrors(shown);
      // A refusal of a field the page does not show: its own words.
      const other = Object.values(fields)[0];
      setProblem(
        Object.keys(shown).length === 0 && other
          ? other
          : problemMessage(error),
      );
      focusFirst(shown);
    },
  });

  function focusFirst(found: ProductErrors) {
    const first = FIELD_ORDER.find((name) => found[name]);
    if (first) {
      boxes.current[first]?.focus();
    }
  }

  function box(name: ProductProblem) {
    return (element: HTMLElement | null) => {
      boxes.current[name] = element;
    };
  }

  function set<K extends keyof ProductValues>(key: K, value: ProductValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    // A change clears its mark, and the marks that depend on it.
    const cleared: ProductProblem[] =
      key === 'isActive'
        ? ['images']
        : key === 'type'
          ? ['type', 'licenceNumber']
          : [key as ProductProblem];
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
    const found = check(values, product);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setProblem(NEEDS_CHANGES);
      focusFirst(found);
      return;
    }
    setProblem(null);
    if (!product) {
      save.mutate({ input: newProduct(values), sent: values });
      return;
    }
    const changed = changes(values, initial);
    if (Object.keys(changed).length === 0) {
      toasts.show('There are no changes to save.');
      return;
    }
    save.mutate({ input: changed, sent: values });
  }

  function discard() {
    setValues(initial);
    setErrors({});
    setProblem(null);
  }

  const madeSlug = slugify(values.name);
  const slugHint = product
    ? values.slug.trim() !== product.slug
      ? "Changing it changes the product's web address: old links to it stop working."
      : "Part of the product's web address."
    : `Leave empty to use “${madeSlug || '…'}”.`;
  const missing = missingToGoLive(toFields(values));

  return (
    <>
      <motion.form
        noValidate
        onSubmit={submit}
        variants={staggered}
        initial="hidden"
        animate="shown"
        className="mt-8 space-y-6"
      >
        <FormSection
          title="Basics"
          description="What customers read about it in the shop."
        >
          <Field
            ref={box('name')}
            label="Name"
            value={values.name}
            onChange={(event) => set('name', event.target.value)}
            maxLength={LIMITS.name}
            autoComplete="off"
            error={errors.name}
            className="sm:col-span-2"
          />
          <SelectField
            ref={box('categoryId')}
            label="Category"
            value={values.categoryId}
            onChange={(event) => set('categoryId', event.target.value)}
            error={errors.categoryId}
          >
            <option value="">Choose a category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.isActive
                  ? category.name
                  : `${category.name} (hidden)`}
              </option>
            ))}
          </SelectField>
          <Field
            ref={box('slug')}
            label="Slug"
            value={values.slug}
            onChange={(event) => set('slug', event.target.value)}
            maxLength={SLUG_MAX}
            autoComplete="off"
            spellCheck={false}
            placeholder={product ? undefined : madeSlug}
            hint={slugHint}
            error={errors.slug}
          />
          <TextAreaField
            ref={box('summary')}
            label="Summary"
            value={values.summary}
            onChange={(event) => set('summary', event.target.value)}
            maxLength={LIMITS.summary}
            rows={2}
            hint="One line for the product lists."
            error={errors.summary}
            className="sm:col-span-2"
          />
          <TextAreaField
            ref={box('description')}
            label="Description"
            value={values.description}
            onChange={(event) => set('description', event.target.value)}
            maxLength={LIMITS.description}
            rows={6}
            error={errors.description}
            className="sm:col-span-2"
          />
          <TextAreaField
            ref={box('usage')}
            label="How to use"
            value={values.usage}
            onChange={(event) => set('usage', event.target.value)}
            maxLength={LIMITS.usage}
            rows={3}
            error={errors.usage}
            className="sm:col-span-2"
          />
        </FormSection>

        <FormSection
          title="Label details"
          description="As printed on the pack. Needed before the product can go live."
        >
          <SelectField
            ref={box('type')}
            label="Type"
            value={values.type}
            onChange={(event) =>
              set('type', event.target.value as ProductType | '')
            }
            error={errors.type}
          >
            <option value="">Choose a type</option>
            {PRODUCT_TYPES.map((type) => (
              <option key={type} value={type}>
                {PRODUCT_TYPE_NAMES[type]}
              </option>
            ))}
          </SelectField>
          <Field
            ref={box('licenceNumber')}
            label="Licence number"
            value={values.licenceNumber}
            onChange={(event) => set('licenceNumber', event.target.value)}
            maxLength={LIMITS.licenceNumber}
            autoComplete="off"
            spellCheck={false}
            hint={LICENCE_HINTS[values.type]}
            error={errors.licenceNumber}
          />
          <Field
            ref={box('manufacturerName')}
            label="Manufacturer"
            value={values.manufacturerName}
            onChange={(event) => set('manufacturerName', event.target.value)}
            maxLength={LIMITS.manufacturerName}
            autoComplete="off"
            error={errors.manufacturerName}
          />
          <Field
            ref={box('countryOfOrigin')}
            label="Country of origin"
            value={values.countryOfOrigin}
            onChange={(event) => set('countryOfOrigin', event.target.value)}
            maxLength={LIMITS.countryOfOrigin}
            autoComplete="off"
            error={errors.countryOfOrigin}
          />
          <TextAreaField
            ref={box('manufacturerAddress')}
            label="Manufacturer's address"
            value={values.manufacturerAddress}
            onChange={(event) => set('manufacturerAddress', event.target.value)}
            maxLength={LIMITS.manufacturerAddress}
            rows={3}
            error={errors.manufacturerAddress}
            className="sm:col-span-2"
          />
          <TextAreaField
            ref={box('ingredients')}
            label="Ingredients"
            value={values.ingredients}
            onChange={(event) => set('ingredients', event.target.value)}
            maxLength={LIMITS.ingredients}
            rows={4}
            hint="Exactly as printed on the pack."
            error={errors.ingredients}
            className="sm:col-span-2"
          />
        </FormSection>

        <FormSection
          title="Tax"
          description="For invoices. Needed before the product can go live."
        >
          <Field
            ref={box('hsnCode')}
            label="HSN code"
            value={values.hsnCode}
            onChange={(event) => set('hsnCode', event.target.value)}
            maxLength={11}
            inputMode="numeric"
            autoComplete="off"
            hint="4, 6 or 8 digits, such as 3004."
            error={errors.hsnCode}
          />
          <SelectField
            ref={box('gstRate')}
            label="GST rate"
            value={values.gstRate}
            onChange={(event) => set('gstRate', event.target.value)}
            hint="Your chartered accountant confirms the rate for the HSN code."
            error={errors.gstRate}
          >
            <option value="">Choose a rate</option>
            {GST_RATES.map((rate) => (
              <option key={rate} value={String(rate)}>
                {rate}%
              </option>
            ))}
          </SelectField>
        </FormSection>

        <FormSection title="In the shop">
          {product ? (
            <Switch
              ref={box('images')}
              label="Customers see it"
              checked={values.isActive}
              onChange={(isActive) => set('isActive', isActive)}
              hint={liveHint(product, values.isActive, missing)}
              error={errors.images}
              className="sm:col-span-2"
            />
          ) : (
            <p className="text-sm text-ink-muted sm:col-span-2">
              A new product starts as a draft: customers don&apos;t see it. Make
              it live once its details and an image are in.
            </p>
          )}
        </FormSection>

        <SaveBar
          problem={problem}
          dirty={dirty}
          saving={save.isPending}
          isNew={!product}
          listPath={listPath}
          onDiscard={discard}
        />
        {prompt}
      </motion.form>

      {product && canDelete ? (
        <>
          <DangerZone onDelete={() => setDeleting(true)} />
          <DeleteProductDialog
            open={deleting}
            product={product}
            onClose={() => setDeleting(false)}
            onDeleted={() => {
              setDeleting(false);
              allowLeaving();
              void navigate(listPath, { replace: true });
            }}
            onHidden={() => {
              setInitial((current) => ({ ...current, isActive: false }));
              setValues((current) => ({ ...current, isActive: false }));
            }}
          />
        </>
      ) : null}
    </>
  );
}

function liveHint(product: Product, live: boolean, missing: string[]): string {
  if (live) {
    return product.isActive
      ? 'It is in the shop.'
      : 'It goes live when you save.';
  }
  if (product.isActive) {
    return 'It leaves the shop when you save.';
  }
  return missing.length > 0
    ? `Before it can go live: ${missing.join(', ')}, and an image.`
    : 'Before it can go live: an image.';
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <motion.section
      variants={rise}
      aria-labelledby={id}
      className="rounded-card border border-line bg-surface p-5 sm:p-6"
    >
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
      ) : null}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">{children}</div>
    </motion.section>
  );
}

// Stays at the bottom of the window: what is wrong or unsaved, and the
// buttons.
function SaveBar({
  problem,
  dirty,
  saving,
  isNew,
  listPath,
  onDiscard,
}: {
  problem: string | null;
  dirty: boolean;
  saving: boolean;
  isNew: boolean;
  listPath: To;
  onDiscard: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-20 -mx-6 border-t border-line bg-canvas/90 px-6 py-3 backdrop-blur lg:-mx-10 lg:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-h-5 text-sm">
          <AnimatePresence mode="wait" initial={false}>
            {problem ? (
              <motion.p
                key="problem"
                role="alert"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-danger"
              >
                {problem}
              </motion.p>
            ) : dirty ? (
              <motion.p
                key="dirty"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-ink-muted"
              >
                Unsaved changes
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>
        <div className="flex gap-2">
          {isNew ? (
            <Link to={listPath} className={buttonClass()}>
              Cancel
            </Link>
          ) : dirty ? (
            <Button onClick={onDiscard} disabled={saving}>
              Discard changes
            </Button>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            busy={saving}
            busyLabel="Saving…"
          >
            {isNew ? 'Add product' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DangerZone({ onDelete }: { onDelete: () => void }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-card border border-danger/30 p-5 sm:p-6"
    >
      <div>
        <h2 id={id} className="font-semibold">
          Delete this product
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          It is removed for good, with its pack sizes and images.
        </p>
      </div>
      <Button variant="danger" icon={Trash2} onClick={onDelete}>
        Delete product
      </Button>
    </section>
  );
}
