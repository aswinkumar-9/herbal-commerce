import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/Button';
import { SearchBox, searchWords } from '../components/SearchBox';
import { FILTER_KINDS, FILTER_NAMES, catalogMatches } from './sales-filters';
import type { FilterKind, FilterMatch, SalesFilter } from './sales-filters';
import { useCatalogNames, useProductMatches } from './sales-queries';

// Narrowing the Sales page to a product, a category or a brand (part 15D,
// ADR 0047): a search over all three by name, each match a button, and
// each filter in use a chip that takes it off. One of each kind at a time:
// choosing another product replaces the product.
export function SalesFilterBar({
  filter,
  names,
  onChoose,
  onRemove,
  onClear,
}: {
  filter: SalesFilter;
  // What each filter in use is called.
  names: Partial<Record<FilterKind, string>>;
  onChoose: (match: FilterMatch) => void;
  onRemove: (kind: FilterKind) => void;
  onClear: () => void;
}) {
  const [words, setWords] = useState('');
  const wanted = searchWords(words);
  const { categories, brands } = useCatalogNames(wanted !== undefined);
  const products = useProductMatches(wanted);
  const matches: FilterMatch[] = wanted
    ? [
        ...(products.data?.products ?? []).map((product) => ({
          kind: 'product' as const,
          id: product.id,
          name: product.name,
        })),
        ...catalogMatches(wanted, categories.data ?? [], brands.data ?? []),
      ]
    : [];
  const inUse = FILTER_KINDS.filter((kind) => filter[kind] !== undefined);

  function choose(match: FilterMatch) {
    setWords('');
    onChoose(match);
  }

  return (
    <div className="mt-6 grid items-start gap-4 lg:grid-cols-[20rem_1fr]">
      <div>
        <SearchBox
          label="Narrow to a product, category or brand"
          current={words}
          onSearch={setWords}
        />
        {wanted ? (
          <div className="mt-2 rounded-card border border-line bg-surface p-2 shadow-clay-sm inset-shadow-clay">
            <output className="sr-only">
              {products.isFetching
                ? 'Looking…'
                : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`}
            </output>
            {matches.length > 0 ? (
              <ul aria-label="Matches" className="space-y-0.5">
                {matches.map((match) => (
                  <li key={`${match.kind}:${match.id}`}>
                    <button
                      type="button"
                      onClick={() => choose(match)}
                      className="flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      <span className="min-w-0 truncate font-medium">
                        {match.name}
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {FILTER_NAMES[match.kind]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-2 text-sm text-ink-muted">
                {products.isFetching
                  ? 'Looking…'
                  : 'No product, category or brand has these words.'}
              </p>
            )}
            {products.isError || categories.isError || brands.isError ? (
              <p className="px-3 py-2 text-sm text-danger">
                Not everything could be searched. Try again in a moment.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {inUse.length > 0 ? (
        <div className="min-w-0 lg:pt-7">
          <ul
            aria-label="Narrowed to"
            className="flex flex-wrap items-center gap-2"
          >
            {inUse.map((kind) => (
              <li
                key={kind}
                className="flex items-center gap-1 rounded-full bg-primary-soft py-1 pr-1 pl-3 text-sm font-medium text-primary-strong shadow-chip"
              >
                <span>
                  {FILTER_NAMES[kind]}: {names[kind] ?? '…'}
                </span>
                <button
                  type="button"
                  aria-label={`Show every ${FILTER_NAMES[kind].toLowerCase()}`}
                  onClick={() => onRemove(kind)}
                  className="grid size-7 place-items-center rounded-full transition-colors duration-150 hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
            <li>
              <Button size="sm" variant="ghost" onClick={onClear}>
                Show all sales
              </Button>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
