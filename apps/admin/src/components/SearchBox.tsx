import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';

// Typing pauses this long before the search is sent.
const SEARCH_PAUSE_MS = 300;
// As the API takes: at most 100 characters.
const SEARCH_MAX = 100;

// The words as the API reads them: each run of spaces made one.
export const tidyWords = (text: string) => text.trim().replace(/\s+/g, ' ');

// At least two characters, else no search.
export function searchWords(text: string): string | undefined {
  const words = tidyWords(text);
  return words.length >= 2 ? words : undefined;
}

// A search box: the words are sent once typing pauses, or at once with
// Enter, and only from two characters on.
//
// What is typed is the box's own state, so each key redraws the box alone,
// never the page and its long list (part 14B). It follows the search the
// page shows (`current`) when that changes from outside, as when the
// filters are cleared or Back is pressed; when the change is only the
// words just sent, what is typed stays as it is, spaces and all.
export function SearchBox({
  label,
  onSearch,
  current,
}: {
  label: string;
  onSearch: (text: string) => void;
  current: string;
}) {
  const [text, setText] = useState(current);
  const [shown, setShown] = useState(current);
  if (shown !== current) {
    setShown(current);
    if (tidyWords(text) !== tidyWords(current)) {
      setText(current);
    }
  }
  const id = useId();
  const hintId = `${id}-hint`;
  const short = tidyWords(text).length === 1;
  const changed = tidyWords(text) !== tidyWords(current);
  const search = useRef(onSearch);
  useEffect(() => {
    search.current = onSearch;
  });

  useEffect(() => {
    if (!changed) {
      return;
    }
    const timer = setTimeout(() => search.current(text), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text, changed]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (changed) {
      onSearch(text);
    }
  }

  return (
    <search>
      <form onSubmit={submit}>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <div className="relative mt-1.5">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
          />
          <input
            id={id}
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={SEARCH_MAX}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={short ? hintId : undefined}
            className="h-11 w-full rounded-control border border-line-strong bg-surface pr-3 pl-9 text-ink inset-shadow-well transition-colors duration-150 outline-none placeholder:text-ink-muted/70 focus:border-primary focus:ring-3 focus:ring-primary/15"
          />
        </div>
        {short ? (
          <p id={hintId} className="mt-1.5 text-xs text-ink-muted">
            Type at least 2 characters.
          </p>
        ) : null}
      </form>
    </search>
  );
}
