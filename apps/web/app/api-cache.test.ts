// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  KEEP_AT_MOST,
  apiFind,
  apiGet,
  apiSend,
  forgetKeptAnswers,
} from './api.server.ts';
import { CLIENT_IP_HEADER } from './security-headers.ts';

// A built website's settings: answers kept for 60 seconds.
vi.mock('./config.server.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./config.server.ts')>();
  const config = { ...real.loadConfig({}), apiCacheSeconds: 60 };
  return { ...real, getConfig: () => config };
});

const schema = z.object({ name: z.string() });
const fetchMock = vi.fn<typeof fetch>();
const answer = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const customer = (ip = '203.0.113.7', signal?: AbortSignal) =>
  new Request('http://localhost:3001/products/tulsi-drops', {
    headers: { [CLIENT_IP_HEADER]: ip },
    signal,
  });

beforeEach(() => {
  forgetKeptAnswers();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('answers every visitor gets alike', () => {
  it('are asked of the API once a minute, however many customers come', async () => {
    fetchMock.mockImplementation(async () => answer(200, { name: 'Tulsi' }));
    for (const ip of ['203.0.113.7', '198.51.100.4', '192.0.2.9']) {
      await expect(
        apiGet(customer(ip), 'products/tulsi-drops', schema),
      ).resolves.toEqual({ name: 'Tulsi' });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 61_000);
    await apiGet(customer(), 'products/tulsi-drops', schema);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('are kept apart by their whole address, search words included', async () => {
    fetchMock.mockImplementation(async () => answer(200, { name: 'Tulsi' }));
    const search = (q: string) =>
      apiGet(customer(), 'products', schema, new URLSearchParams({ q }));
    await search('tulsi');
    await search('neem');
    await search('tulsi');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('share one question when customers ask at the same moment', async () => {
    let reply!: (response: Response) => void;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (reply = resolve)),
    );
    const both = Promise.all([
      apiGet(customer('203.0.113.7'), 'products/tulsi-drops', schema),
      apiGet(customer('198.51.100.4'), 'products/tulsi-drops', schema),
    ]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    reply(answer(200, { name: 'Tulsi' }));
    await expect(both).resolves.toEqual([{ name: 'Tulsi' }, { name: 'Tulsi' }]);
  });

  it('go on for those still waiting when the first customer leaves', async () => {
    let reply!: (response: Response) => void;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (reply = resolve)),
    );
    const leaving = new AbortController();
    const first = apiGet(
      customer('203.0.113.7', leaving.signal),
      'products/tulsi-drops',
      schema,
    );
    const second = apiGet(
      customer('198.51.100.4'),
      'products/tulsi-drops',
      schema,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    leaving.abort();
    await expect(first).rejects.toBeDefined();
    reply(answer(200, { name: 'Tulsi' }));
    await expect(second).resolves.toEqual({ name: 'Tulsi' });
  });

  it('keep "not found" too, but never a failure', async () => {
    fetchMock.mockResolvedValueOnce(answer(404));
    await expect(
      apiFind(customer(), 'policies/returns', schema),
    ).resolves.toBeNull();
    await expect(
      apiFind(customer(), 'policies/returns', schema),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(answer(503));
    const busy = (await apiGet(customer(), 'categories', schema).catch(
      (error: unknown) => error,
    )) as { init?: ResponseInit };
    expect(busy.init?.status).toBe(503);
    fetchMock.mockResolvedValueOnce(answer(200, { name: 'Wellness' }));
    await expect(apiGet(customer(), 'categories', schema)).resolves.toEqual({
      name: 'Wellness',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('drop an answer that is not as expected, and ask again next time', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { nothing: 'useful' }));
    await expect(
      apiGet(customer(), 'categories', schema),
    ).rejects.toBeDefined();
    fetchMock.mockResolvedValueOnce(answer(200, { name: 'Wellness' }));
    await expect(apiGet(customer(), 'categories', schema)).resolves.toEqual({
      name: 'Wellness',
    });
  });

  it(`keep at most ${KEEP_AT_MOST} addresses, the least recently used going first`, async () => {
    fetchMock.mockImplementation(async () => answer(200, { name: 'Tulsi' }));
    await apiGet(customer(), 'products/first', schema);
    for (let at = 0; at < KEEP_AT_MOST; at += 1) {
      await apiGet(customer(), `products/p-${at}`, schema);
    }
    const asked = fetchMock.mock.calls.length;
    await apiGet(customer(), 'products/p-1', schema);
    expect(fetchMock).toHaveBeenCalledTimes(asked);
    await apiGet(customer(), 'products/first', schema);
    expect(fetchMock).toHaveBeenCalledTimes(asked + 1);
  });

  it('never include what a signed-in customer or a form asks', async () => {
    fetchMock.mockImplementation(async () => answer(200, { name: 'Asha' }));
    for (let time = 0; time < 2; time += 1) {
      await apiSend(
        customer(),
        { method: 'GET', path: 'me', accessToken: 'stand.in.token' },
        schema,
      );
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
