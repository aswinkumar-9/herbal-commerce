import { vi } from 'vitest';

// A stand-in for the browser's IntersectionObserver (jsdom has none): a
// test says what is in view, and when.
export class FakeObserver {
  static all: FakeObserver[] = [];
  readonly watched = new Set<Element>();
  readonly report: (entries: IntersectionObserverEntry[]) => void;
  readonly options: IntersectionObserverInit | undefined;
  constructor(
    report: (entries: IntersectionObserverEntry[]) => void,
    options?: IntersectionObserverInit,
  ) {
    this.report = report;
    this.options = options;
    FakeObserver.all.push(this);
  }
  observe(target: Element): void {
    this.watched.add(target);
  }
  unobserve(target: Element): void {
    this.watched.delete(target);
  }
  disconnect(): void {
    this.watched.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  // Reports these elements as in view or not, as the browser would.
  show(targets: Element[], isIntersecting = true): void {
    this.report(
      targets
        .filter((target) => this.watched.has(target))
        .map(
          (target) =>
            ({
              target,
              isIntersecting,
            }) as unknown as IntersectionObserverEntry,
        ),
    );
  }
}

export function fakeObservers(): void {
  FakeObserver.all = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  // jsdom has no Web Animations either.
  Element.prototype.animate = vi.fn() as unknown as Element['animate'];
}

// Every watched element's report, across all observers.
export function report(targets: Element[], isIntersecting = true): void {
  for (const observer of FakeObserver.all) {
    observer.show(targets, isIntersecting);
  }
}
