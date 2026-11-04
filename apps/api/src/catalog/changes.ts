// What a change to a category or a product really changes, so that only
// that is saved and audited (ADR 0020).

// The fields the change gives a new value. A field sent with the value it
// already has is no change.
export function changedFields<I extends object>(
  current: { [K in keyof I]?: unknown },
  input: I,
): (keyof I)[] {
  return (Object.keys(input) as (keyof I)[]).filter(
    (field) => input[field] !== undefined && input[field] !== current[field],
  );
}

// Only these fields of a record or a change.
export function pick<T extends object, K extends keyof T>(
  from: T,
  fields: readonly K[],
): Partial<Pick<T, K>> {
  return Object.fromEntries(
    fields.map((field) => [field, from[field]]),
  ) as Partial<Pick<T, K>>;
}
