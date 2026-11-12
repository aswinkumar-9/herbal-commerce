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
import { Field, TextAreaField } from '../../components/Field';
import { Switch } from '../../components/Switch';
import { useToasts } from '../../components/toast-context';
import { useUnsavedChanges } from '../../components/unsaved-changes';
import { createCategory, updateCategory } from '../catalog-api';
import type { Category, CategoryFields } from '../catalog-api';
import { catalogKeys, putCategory } from '../catalog-queries';
import { SLUG_PATTERN, slugify } from '../slug';

const SAVING = ['category-form'] as const;
export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 500;

type FieldName = 'name' | 'slug' | 'description';
interface Values {
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
}

interface EditorProps {
  open: boolean;
  // null: a new category.
  category: Category | null;
  // Where a new category goes: after the last one.
  nextPosition: number;
  onClose: () => void;
}

// Adds a category or changes one, in a dialog over the list.
export function CategoryEditor({
  open,
  category,
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
      title={category ? `Edit ${category.name}` : 'New category'}
    >
      <CategoryForm
        category={category}
        nextPosition={nextPosition}
        onDone={onClose}
      />
    </Dialog>
  );
}

function startingValues(category: Category | null): Values {
  return {
    name: category?.name ?? '',
    slug: category?.slug ?? '',
    description: category?.description ?? '',
    isActive: category?.isActive ?? false,
  };
}

// The same checks as the API, so most mistakes are caught before sending.
function check(values: Values, category: Category | null) {
  const errors: Partial<Record<FieldName, string>> = {};
  const name = values.name.trim();
  const slug = values.slug.trim();
  if (!name) {
    errors.name = 'Enter a name';
  }
  if (slug && !SLUG_PATTERN.test(slug)) {
    errors.slug =
      'Use lowercase letters, digits and single hyphens, like "hair-care"';
  } else if (!slug && category) {
    errors.slug = 'Enter a slug';
  } else if (!slug && name && !slugify(name)) {
    errors.slug = 'The name has no Latin letters or digits: enter a slug';
  }
  return errors;
}

// What a change sends: only the fields that changed.
function changes(values: Values, category: Category): Partial<CategoryFields> {
  const changed: Partial<CategoryFields> = {};
  const name = values.name.trim();
  const slug = values.slug.trim();
  const description = values.description.trim() || null;
  if (name !== category.name) {
    changed.name = name;
  }
  if (slug !== category.slug) {
    changed.slug = slug;
  }
  if (description !== category.description) {
    changed.description = description;
  }
  if (values.isActive !== category.isActive) {
    changed.isActive = values.isActive;
  }
  return changed;
}

function CategoryForm({
  category,
  nextPosition,
  onDone,
}: {
  category: Category | null;
  nextPosition: number;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [initial] = useState(() => startingValues(category));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const boxes = useRef<Partial<Record<FieldName, HTMLElement | null>>>({});

  const dirty = (Object.keys(initial) as (keyof Values)[]).some(
    (key) => values[key] !== initial[key],
  );
  const { prompt } = useUnsavedChanges(dirty);

  const save = useMutation({
    mutationKey: SAVING,
    mutationFn: (input: Partial<CategoryFields> & { position?: number }) =>
      category
        ? updateCategory(category.id, input)
        : createCategory(input as CategoryFields),
    onSuccess: (saved) => {
      if (category) {
        putCategory(queryClient, saved);
        toasts.show(`${saved.name} saved`);
      } else {
        void queryClient.invalidateQueries({
          queryKey: catalogKeys.categories(),
        });
        toasts.show(`${saved.name} added`);
      }
      onDone();
    },
    onError: (error) => {
      const fields = fieldProblems(error);
      const shown: Partial<Record<FieldName, string>> = {};
      for (const name of ['name', 'slug', 'description'] as const) {
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
    const first = (['name', 'slug', 'description'] as const).find(
      (name) => found[name],
    );
    if (first) {
      boxes.current[first]?.focus();
    }
  }

  function set<K extends keyof Values>(key: K, value: Values[K]) {
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
    const found = check(values, category);
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    if (category) {
      const changed = changes(values, category);
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
      description: values.description.trim() || null,
      isActive: values.isActive,
      position: nextPosition,
    });
  }

  const madeSlug = slugify(values.name);
  const slugHint = category
    ? values.slug.trim() !== category.slug
      ? "Changing it changes the category's web address: old links to it stop working."
      : "Part of the category's web address."
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
        maxLength={NAME_MAX}
        autoComplete="off"
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
        placeholder={category ? undefined : madeSlug}
        hint={slugHint}
        error={errors.slug}
      />
      <TextAreaField
        ref={(box) => {
          boxes.current.description = box;
        }}
        label="Description"
        value={values.description}
        onChange={(event) => set('description', event.target.value)}
        maxLength={DESCRIPTION_MAX}
        rows={3}
        hint="Optional."
        error={errors.description}
      />
      <Switch
        label="Customers see it"
        hint={
          category ? undefined : 'Leave it off until its products are ready.'
        }
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
          {category ? 'Save changes' : 'Add category'}
        </Button>
      </DialogActions>
      {prompt}
    </form>
  );
}
