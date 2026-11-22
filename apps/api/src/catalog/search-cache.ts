import { Injectable } from '@nestjs/common';

// How long the shop's search keeps what it read of the catalog, and for
// how many different searches (part 14B, after the Lighthouse audit).
export const SEARCH_KEPT_SECONDS = 60;
export const SEARCHES_KEPT = 100;

// What the shop's search read of the catalog for some words, a category and
// a type: the products that match, with their packs, prices and photo, and
// how well each matches. The costly part of a search (ADR 0030): every
// page of the results, every sort and every price filter reads the same.
// Stock is never kept here: it changes with every order, so the search
// asks the inventory each time.
//
// Kept in this process's memory only, for SEARCH_KEPT_SECONDS at most, and
// forgotten at once when staff change the catalog (CatalogChanged). Search
// words are held as keys for that long only, never stored or logged. With
// more than one API process, a change made through one reaches the others'
// searches within SEARCH_KEPT_SECONDS.
@Injectable()
export class SearchCache {
  private readonly kept = new Map<string, { value: unknown; until: number }>();
  private readonly reading = new Map<string, Promise<unknown>>();
  // Each change to the catalog starts a new generation: a read begun
  // before it is used by those waiting on it, but never kept.
  private generation = 0;

  async read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.kept.get(key);
    if (hit && hit.until > Date.now()) {
      // The most recently used go last, so the oldest go first.
      this.kept.delete(key);
      this.kept.set(key, hit);
      return hit.value as T;
    }
    const pending = this.reading.get(key);
    if (pending) {
      return pending as Promise<T>;
    }
    const generation = this.generation;
    const loading = load()
      .then((value) => {
        if (generation === this.generation) {
          this.keep(key, value);
        }
        return value;
      })
      .finally(() => {
        if (this.reading.get(key) === loading) {
          this.reading.delete(key);
        }
      });
    this.reading.set(key, loading);
    return loading;
  }

  // Staff changed the catalog: nothing read before counts any more.
  forget(): void {
    this.generation += 1;
    this.kept.clear();
    this.reading.clear();
  }

  private keep(key: string, value: unknown): void {
    this.kept.delete(key);
    this.kept.set(key, {
      value,
      until: Date.now() + SEARCH_KEPT_SECONDS * 1000,
    });
    for (const oldest of this.kept.keys()) {
      if (this.kept.size <= SEARCHES_KEPT) {
        break;
      }
      this.kept.delete(oldest);
    }
  }
}
