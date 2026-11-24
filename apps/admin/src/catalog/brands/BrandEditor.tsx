import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { fieldProblems, problemMessage } from '../../api/problems';
import { Button } from '../../components/Button';
import { Dialog, DialogActions } from '../../components/Dialog';
import { Field } from '../../components/Field';
import { useToasts } from '../../components/toast-context';
import { useUnsavedChanges } from '../../components/unsaved-changes';
import { createBrand, updateBrand } from '../catalog-api';
import type { Brand, BrandFields } from '../catalog-api';
import { catalogKeys, putBrand } from '../catalog-queries';
import { SLUG_PATTERN, slugify } from '../slug';

const SAVING = ['brand-form'] as const;
export const BRAND_NAME_MAX = 60;

type FieldName = 'name' | 'slug';
interface Values {
  name: string;
  slug: string;
}

interface EditorProps {
  open: boolean;
  // null: a new brand.
  brand: Brand | null;
  onClose: () => void;
}

// Adds a brand or changes one, in a dialog over the list.
export function BrandEditor({ open, brand, onClose }: EditorProps) {
  const saving = useIsMutating({ mutationKey: SAVING }) > 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={saving}
      size="md"
      title={brand ? `Edit ${brand.name}` : 'New brand'}
    >
      <BrandForm brand={brand} onDone={onClose} />
    </Dialog>
  );
}

// The same checks as the API, so most mistakes are caught before sending.
function check(values: Values, brand: Brand | null) {
  const errors: Partial<Record<FieldName, string>> = {};
  const name = values.name.trim();
  const slug = values.slug.trim();
  if (!name) {
    errors.name = 'Enter a name';
  }
  if (slug && !SLUG_PATTERN.test(slug)) {
    errors.slug =
      'Use lowercase letters, digits and single hyphens, like "himalaya"';
  } else if (!slug && brand) {
    errors.slug = 'Enter a slug';
  } else if (!slug && name && !slugify(name)) {
    errors.slug = 'The name has no Latin letters or digits: enter a slug';
  }
  return errors;
}

// What a change sends: only the fields that changed.
function changes(values: Values, brand: Brand): Partial<BrandFields> {
  const changed: Partial<BrandFields> = {};
  const name = values.name.trim();
  const slug = values.slug.trim();
  if (name !== brand.name) {
    changed.name = name;
  }
  if (slug !== brand.slug) {
    changed.slug = slug;
  }
  return changed;
}

function BrandForm({
  brand,
  onDone,
}: {
  brand: Brand | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [initial] = useState<Values>(() => ({
    name: brand?.name ?? '',
    slug: brand?.slug ?? '',
  }));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const boxes = useRef<Partial<Record<FieldName, HTMLElement | null>>>({});

  const dirty = values.name !== initial.name || values.slug !== initial.slug;
  const { prompt } = useUnsavedChanges(dirty);

  const save = useMutation({
    mutationKey: SAVING,
    mutationFn: (input: Partial<BrandFields>) =>
      brand ? updateBrand(brand.id, input) : createBrand(input as BrandFields),
    onSuccess: (saved) => {
      if (brand) {
        putBrand(queryClient, saved);
        toasts.show(`${saved.name} saved`);
      } else {
        toasts.show(`${saved.name} added`);
      }
      // A new brand takes its place by name, and a renamed one may move.
      void queryClient.invalidateQueries({ queryKey: catalogKeys.brands() });
      onDone();
    },
    onError: (error) => {
      const fields = fieldProblems(error);
      const shown: Partial<Record<FieldName, string>> = {};
      for (const name of ['name', 'slug'] as const) {
        if (fields[name]) {
          shown[name] = fields[name];
        }
      }
      setErrors(shown);
      setProblem(Object.keys(shown).length > 0 ? null : problemMessage(error));
      focusFirst(shown);
    },
  });

  function focusFirst(found: Partial<Record<FieldName, string>>) {
    const first = (['name', 'slug'] as const).find((name) => found[name]);
    if (first) {
      boxes.current[first]?.focus();
    }
  }

  function set(key: FieldName, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    if (key in errors) {
      setErrors((current) => ({ ...current, [key]: undefined }));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) {
      return;
    }
    const found = check(values, brand);
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    if (brand) {
      const changed = changes(values, brand);
      if (Object.keys(changed).length === 0) {
        onDone();
        return;
      }
      save.mutate(changed);
      return;
    }
    save.mutate({
      name: values.name.trim(),
      ...(values.slug.trim() ? { slug: values.slug.trim() } : {}),
    });
  }

  const madeSlug = slugify(values.name);
  const slugHint = brand
    ? values.slug.trim() !== brand.slug
      ? "Changing it changes the brand's web address in the shop: old links to it stop working."
      : "Part of the brand's web address in the shop."
    : `Leave empty to use “${madeSlug || '…'}”.`;

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
      <Field
        ref={(box) => {
          boxes.current.name = box;
        }}
        label="Name"
        value={values.name}
        onChange={(event) => set('name', event.target.value)}
        maxLength={BRAND_NAME_MAX}
        autoComplete="off"
        hint="As the pack prints it."
        error={errors.name}
      />
      <Field
        ref={(box) => {
          boxes.current.slug = box;
        }}
        label="Slug"
        value={values.slug}
        onChange={(event) => set('slug', event.target.value)}
        maxLength={60}
        autoComplete="off"
        spellCheck={false}
        placeholder={brand ? undefined : madeSlug}
        hint={slugHint}
        error={errors.slug}
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
          {brand ? 'Save changes' : 'Add brand'}
        </Button>
      </DialogActions>
      {prompt}
    </form>
  );
}
