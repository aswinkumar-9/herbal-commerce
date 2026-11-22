import type { StockService } from '../inventory/stock.service';
import type { MediaStorage } from '../media/media-storage';
import type { PrismaService } from '../prisma/prisma.service';
import { productSearchQuerySchema } from './product-search.schemas';
import {
  ProductSearchService,
  SEARCH_CANDIDATES,
} from './product-search.service';
import { SearchCache } from './search-cache';

const BASE = 'http://127.0.0.1:3000/media';
const KEY = 'b1c2d3e4-5f60-4a7b-8c9d-0e1f2a3b4c5d';

// A product as the search reads it: its packs on sale, by ID and price.
const row = (slug: string, prices: number[] = [], name = slug) => ({
  id: `id-${slug}`,
  name,
  slug,
  summary: null,
  variants: prices.map((priceRupees, index) => ({
    id: `${slug}-pack-${index}`,
    priceRupees,
  })),
  images: [{ fileKey: KEY }],
});

// What a customer sees of it.
const card = (
  slug: string,
  fromPriceRupees: number | null,
  inStock: boolean,
  name = slug,
) => ({
  name,
  slug,
  summary: null,
  fromPriceRupees,
  imageUrl: `${BASE}/products/${KEY}-small.webp`,
  inStock,
});

function setup(rows: object[], inStock: string[] = []) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    product: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  const stock = { inStock: jest.fn().mockResolvedValue(new Set(inStock)) };
  const media = { url: jest.fn((name: string) => `${BASE}/${name}`) };
  const kept = new SearchCache();
  const service = new ProductSearchService(
    prisma as unknown as PrismaService,
    stock as unknown as StockService,
    media as unknown as MediaStorage,
    kept,
  );
  return { service, prisma, stock, kept };
}

const search = (query: object) => productSearchQuerySchema.parse(query);
const slugs = (page: { products: { slug: string }[] }) =>
  page.products.map((product) => product.slug);

describe('ProductSearchService.search', () => {
  it('without words, weighs every live product in an active category, by name, and asks the inventory about every pack on sale', async () => {
    const { service, prisma, stock } = setup(
      [row('amla-juice', [199, 149]), row('brahmi-oil', [349])],
      ['amla-juice-pack-1', 'brahmi-oil-pack-0'],
    );

    await expect(service.search(search({}))).resolves.toEqual({
      products: [card('amla-juice', 149, true), card('brahmi-oil', 349, true)],
      total: 2,
      page: 1,
      nextPage: null,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { isActive: true, category: { isActive: true } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 500,
      select: {
        id: true,
        name: true,
        slug: true,
        summary: true,
        variants: {
          where: { isActive: true },
          select: { id: true, priceRupees: true },
        },
        images: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { fileKey: true },
        },
      },
    });
    expect(SEARCH_CANDIDATES).toBe(500);
    expect(stock.inStock).toHaveBeenCalledWith([
      'amla-juice-pack-0',
      'amla-juice-pack-1',
      'brahmi-oil-pack-0',
    ]);
  });

  it('filters by an active category and a product type', async () => {
    const { service, prisma } = setup([]);

    await service.search(
      search({ category: 'herbal-teas', type: 'AYURVEDIC_MEDICINE' }),
    );

    expect(prisma.product.findMany.mock.calls[0][0].where).toStrictEqual({
      isActive: true,
      category: { isActive: true, slug: 'herbal-teas' },
      type: 'AYURVEDIC_MEDICINE',
    });
  });

  it('puts the products in stock first, marking the others', async () => {
    const { service } = setup(
      [
        row('amla-juice', [149]),
        row('brahmi-oil', [349]),
        row('chyawanprash', [399]),
      ],
      ['brahmi-oil-pack-0'],
    );

    await expect(service.search(search({}))).resolves.toMatchObject({
      products: [
        card('brahmi-oil', 349, true),
        card('amla-juice', 149, false),
        card('chyawanprash', 399, false),
      ],
    });
  });

  it('finds by words with pg_trgm, the words a bound parameter, and only among the matches, the best first', async () => {
    const { service, prisma } = setup(
      [row('ashwagandha-capsules', [449]), row('ashwagandha-powder', [299])],
      ['ashwagandha-capsules-pack-0', 'ashwagandha-powder-pack-0'],
    );
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'id-ashwagandha-powder', score: 0.9 },
      { id: 'id-ashwagandha-capsules', score: 0.82 },
    ]);

    const page = await service.search(search({ q: 'ashwaganda' }));

    expect(slugs(page)).toEqual(['ashwagandha-powder', 'ashwagandha-capsules']);
    const [sql, ...values] = prisma.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const text = sql.join('?');
    // The name, the summary and the description, the name counting most.
    expect(text).toContain('word_similarity(?, p."name")');
    expect(text).toContain(
      `word_similarity(?, COALESCE(p."summary", '')) * 0.8`,
    );
    expect(text).toContain(
      `word_similarity(?, COALESCE(p."description", '')) * 0.6`,
    );
    expect(text).toContain('? <% p."name"');
    expect(text).toContain('? <% p."summary"');
    expect(text).toContain('? <% p."description"');
    // Live products in active categories only.
    expect(text).toContain('WHERE p."isActive" AND c."isActive"');
    expect(text).toContain('ORDER BY "score" DESC, p."id"');
    expect(values).toEqual([
      'ashwaganda',
      'ashwaganda',
      'ashwaganda',
      'ashwaganda',
      'ashwaganda',
      'ashwaganda',
      500,
    ]);
    expect(prisma.product.findMany.mock.calls[0][0].where.id).toEqual({
      in: ['id-ashwagandha-powder', 'id-ashwagandha-capsules'],
    });
  });

  it('reads nothing more when no product matches the words', async () => {
    const { service, prisma, stock } = setup([row('amla-juice', [149])]);

    await expect(service.search(search({ q: 'xyzzy' }))).resolves.toEqual({
      products: [],
      total: 0,
      page: 1,
      nextPage: null,
    });
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(stock.inStock).toHaveBeenCalledWith([]);
  });

  it('keeps stock first even over a better match', async () => {
    const { service, prisma } = setup(
      [row('tulsi-tea', [199]), row('tulsi-drops', [249])],
      ['tulsi-drops-pack-0'],
    );
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'id-tulsi-tea', score: 1 },
      { id: 'id-tulsi-drops', score: 0.7 },
    ]);

    expect(slugs(await service.search(search({ q: 'tulsi' })))).toEqual([
      'tulsi-drops',
      'tulsi-tea',
    ]);
  });

  it('filters by the lowest price on sale, never keeping a product with no pack on sale', async () => {
    const rows = [
      row('amla-juice', [149, 599]),
      row('brahmi-oil', [349]),
      row('chyawanprash', [599]),
      row('draft-pack', []),
    ];
    const run = async (query: object) =>
      slugs(await setup(rows).service.search(search(query)));

    expect(await run({})).toEqual([
      'amla-juice',
      'brahmi-oil',
      'chyawanprash',
      'draft-pack',
    ]);
    // Amla juice's lowest price is Rs 149: its Rs 599 pack doesn't count.
    expect(await run({ minPriceRupees: 300 })).toEqual([
      'brahmi-oil',
      'chyawanprash',
    ]);
    expect(await run({ maxPriceRupees: 349 })).toEqual([
      'amla-juice',
      'brahmi-oil',
    ]);
    expect(await run({ minPriceRupees: 349, maxPriceRupees: 349 })).toEqual([
      'brahmi-oil',
    ]);
    expect(await run({ minPriceRupees: 0 })).toEqual([
      'amla-juice',
      'brahmi-oil',
      'chyawanprash',
    ]);
  });

  it('sorts by price either way, a product with no pack on sale last, ties by name', async () => {
    const rows = [
      row('amla-juice', [149]),
      row('brahmi-oil', [349]),
      row('chyawanprash', [349]),
      row('draft-pack', []),
    ];
    const all = rows.flatMap((product) =>
      product.variants.map((variant) => variant.id),
    );
    const run = async (sort: string) =>
      slugs(await setup(rows, all).service.search(search({ sort })));

    expect(await run('price-asc')).toEqual([
      'amla-juice',
      'brahmi-oil',
      'chyawanprash',
      'draft-pack',
    ]);
    expect(await run('price-desc')).toEqual([
      'brahmi-oil',
      'chyawanprash',
      'amla-juice',
      'draft-pack',
    ]);
    // Out of stock too, a product with no pack on sale still comes after
    // one with a price, either way.
    for (const sort of ['price-asc', 'price-desc']) {
      const { service } = setup([
        row('draft-pack', []),
        row('amla-juice', [149]),
      ]);
      expect(slugs(await service.search(search({ sort })))).toEqual([
        'amla-juice',
        'draft-pack',
      ]);
    }
  });

  it('sorts by name whatever the letter case, and by slug between equal names, so pages never overlap', async () => {
    const { service } = setup([
      row('neem-wash-b', [99], 'Neem Wash'),
      row('aloe-gel', [99], 'aloe Gel'),
      row('neem-wash-a', [99], 'Neem Wash'),
      row('brahmi-oil', [99], 'Brahmi Oil'),
    ]);

    expect(slugs(await service.search(search({ sort: 'name' })))).toEqual([
      'aloe-gel',
      'brahmi-oil',
      'neem-wash-a',
      'neem-wash-b',
    ]);
  });

  it('answers one page at a time, with how many were found and the next page', async () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((slug) => row(slug, [100]));

    await expect(
      setup(rows).service.search(search({ limit: 2 })),
    ).resolves.toMatchObject({ total: 5, page: 1, nextPage: 2 });
    const second = await setup(rows).service.search(
      search({ limit: 2, page: 2 }),
    );
    expect([slugs(second), second.nextPage]).toEqual([['c', 'd'], 3]);
    const last = await setup(rows).service.search(
      search({ limit: 2, page: 3 }),
    );
    expect([slugs(last), last.total, last.nextPage]).toEqual([['e'], 5, null]);
    const beyond = await setup(rows).service.search(
      search({ limit: 2, page: 4 }),
    );
    expect([slugs(beyond), beyond.total, beyond.nextPage]).toEqual([
      [],
      5,
      null,
    ]);
    // A page that ends exactly at the last product has no next page.
    const exact = await setup(rows.slice(0, 4)).service.search(
      search({ limit: 2, page: 2 }),
    );
    expect(exact.nextPage).toBeNull();
  });

  it('shows no ID, score or pack of a product', async () => {
    const { service, prisma } = setup([row('amla-juice', [149])]);
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'id-amla-juice', score: 1 }]);

    const page = await service.search(search({ q: 'amla' }));

    expect(Object.keys(page.products[0]).sort()).toEqual([
      'fromPriceRupees',
      'imageUrl',
      'inStock',
      'name',
      'slug',
      'summary',
    ]);
  });
});

describe('ProductSearchService.search, keeping what it read', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  const SHOP = [
    row('amla-juice', [149]),
    row('brahmi-oil', [349]),
    row('chyawanprash', [399]),
  ];

  it('reads the catalog once for every page, sort and price filter of the same search, and asks the inventory every time', async () => {
    const { service, prisma, stock } = setup(SHOP, ['amla-juice-pack-0']);

    await service.search(search({ limit: 2 }));
    await service.search(search({ limit: 2, page: 2 }));
    await service.search(search({ sort: 'price-desc' }));
    const cheap = await service.search(search({ maxPriceRupees: 200 }));

    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    expect(stock.inStock).toHaveBeenCalledTimes(4);
    expect(slugs(cheap)).toEqual(['amla-juice']);
  });

  it('shows stock as it is now: a product sold out a moment ago moves down at once', async () => {
    const { service, prisma, stock } = setup(SHOP, ['amla-juice-pack-0']);
    expect(slugs(await service.search(search({}))).at(0)).toBe('amla-juice');

    stock.inStock.mockResolvedValue(new Set(['chyawanprash-pack-0']));
    const now = await service.search(search({}));

    expect(slugs(now)).toEqual(['chyawanprash', 'amla-juice', 'brahmi-oil']);
    expect(now.products.at(0)).toEqual(card('chyawanprash', 399, true));
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
  });

  it('reads again for other words, another category or another type', async () => {
    const { service, prisma } = setup(SHOP);
    prisma.$queryRaw.mockResolvedValue([{ id: 'id-amla-juice', score: 0.9 }]);

    await service.search(search({ q: 'amla' }));
    await service.search(search({ q: 'amla', page: 2 }));
    await service.search(search({ q: 'brahmi' }));
    await service.search(search({ category: 'juices' }));
    await service.search(search({ type: 'AYURVEDIC_MEDICINE' }));

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.product.findMany).toHaveBeenCalledTimes(4);
  });

  it('reads afresh once staff change the catalog, or after a minute', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const { service, prisma, kept } = setup(SHOP);

    await service.search(search({}));
    kept.forget();
    await service.search(search({}));
    expect(prisma.product.findMany).toHaveBeenCalledTimes(2);

    jest.setSystemTime(Date.now() + 59_000);
    await service.search(search({}));
    expect(prisma.product.findMany).toHaveBeenCalledTimes(2);
    jest.setSystemTime(Date.now() + 2_000);
    await service.search(search({}));
    expect(prisma.product.findMany).toHaveBeenCalledTimes(3);
  });

  it('shares one read among searches at the same moment, and never keeps one that failed', async () => {
    const { service, prisma } = setup(SHOP);
    prisma.product.findMany.mockRejectedValueOnce(new Error('database away'));

    const [first, second] = await Promise.allSettled([
      service.search(search({})),
      service.search(search({ page: 2 })),
    ]);
    expect(first.status).toBe('rejected');
    expect(second.status).toBe('rejected');
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);

    await expect(service.search(search({}))).resolves.toMatchObject({
      total: 3,
    });
    expect(prisma.product.findMany).toHaveBeenCalledTimes(2);
  });

  it('never keeps a read begun before staff changed the catalog', async () => {
    const { service, prisma, kept } = setup(SHOP);
    let finish!: (rows: object[]) => void;
    prisma.product.findMany.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );

    const before = service.search(search({}));
    await new Promise(setImmediate);
    kept.forget();
    finish(SHOP);
    await before;
    await service.search(search({}));

    expect(prisma.product.findMany).toHaveBeenCalledTimes(2);
  });
});
