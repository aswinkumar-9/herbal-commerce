import { SEARCHES_KEPT, SearchCache } from './search-cache';

describe('SearchCache', () => {
  it(`keeps at most ${SEARCHES_KEPT} searches, the least recently used going first`, async () => {
    const cache = new SearchCache();
    const load = jest.fn(async () => 'read');

    await cache.read('first', load);
    for (let at = 0; at < SEARCHES_KEPT; at += 1) {
      await cache.read(`search-${at}`, load);
    }
    const loads = load.mock.calls.length;
    // Still kept: the most recent ones.
    await cache.read(`search-${SEARCHES_KEPT - 1}`, load);
    expect(load).toHaveBeenCalledTimes(loads);
    // Gone: the oldest.
    await cache.read('first', load);
    expect(load).toHaveBeenCalledTimes(loads + 1);
  });

  it('counts a search used again as recent', async () => {
    const cache = new SearchCache();
    const load = jest.fn(async () => 'read');

    await cache.read('popular', load);
    for (let at = 0; at < SEARCHES_KEPT - 1; at += 1) {
      await cache.read(`search-${at}`, load);
    }
    await cache.read('popular', load);
    await cache.read('one-more', load);
    const loads = load.mock.calls.length;
    await cache.read('popular', load);
    expect(load).toHaveBeenCalledTimes(loads);
  });
});
