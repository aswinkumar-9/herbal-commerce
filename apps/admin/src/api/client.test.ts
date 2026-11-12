import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fakeApi, json, offline, tokens } from '../test/fake-api';
import { accessToken, setAccessToken } from './access-token';
import { ApiError } from './api-error';
import { apiRequest, onSessionLost, renewSession } from './client';

const REFRESH = 'POST /v1/staff/auth/refresh';
const thing = z.object({ name: z.string() });

describe('the API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the access token from memory, to its own origin only, and keeps nothing in the cache', async () => {
    const api = fakeApi({
      'GET /v1/staff/things': () => json(200, { name: 'tulsi' }),
    });
    setAccessToken('t1');

    await expect(
      apiRequest('/v1/staff/things', { schema: thing }),
    ).resolves.toEqual({
      name: 'tulsi',
    });

    const [request] = api.sent;
    expect(request?.authorization).toBe('Bearer t1');
    expect(request?.init.credentials).toBe('same-origin');
    expect(request?.init.cache).toBe('no-store');
  });

  it('refuses to send anything outside the API', async () => {
    const api = fakeApi({});
    setAccessToken('t1');

    for (const path of [
      'https://elsewhere.example/v1/x',
      '//elsewhere.example/v1/x',
      '/media/x',
    ]) {
      await expect(apiRequest(path)).rejects.toThrow('Not an API path');
    }
    expect(api.sent).toHaveLength(0);
  });

  it('sends sign-in, renewal and sign-out without the access token', async () => {
    const api = fakeApi({ 'POST /v1/staff/auth/logout': () => json(204) });
    setAccessToken('t1');

    await apiRequest('/v1/staff/auth/logout', {
      method: 'POST',
      anonymous: true,
    });

    expect(api.sent[0]?.authorization).toBeNull();
  });

  it('renews an expired access token through the cookie once, and tries again', async () => {
    const api = fakeApi({
      'GET /v1/staff/things': [
        () => json(401, { message: 'Invalid or expired access token' }),
        () => json(200, { name: 'tulsi' }),
      ],
      [REFRESH]: () => json(200, tokens('t2')),
    });
    setAccessToken('t1');

    await expect(
      apiRequest('/v1/staff/things', { schema: thing }),
    ).resolves.toEqual({
      name: 'tulsi',
    });

    expect(api.sent.map((r) => [r.method, r.path, r.authorization])).toEqual([
      ['GET', '/v1/staff/things', 'Bearer t1'],
      // No body and no token: the refresh token is in the HttpOnly cookie.
      ['POST', '/v1/staff/auth/refresh', null],
      ['GET', '/v1/staff/things', 'Bearer t2'],
    ]);
    expect(api.sent[1]?.body).toBeUndefined();
    expect(accessToken()).toBe('t2');
  });

  it('renews only once when several requests find the token expired together', async () => {
    let swapped = false;
    const api = fakeApi({
      'GET /v1/staff/things': () =>
        swapped ? json(200, { name: 'tulsi' }) : json(401, {}),
      [REFRESH]: () => {
        swapped = true;
        return json(200, tokens('t2'));
      },
    });
    setAccessToken('t1');

    await Promise.all([
      apiRequest('/v1/staff/things', { schema: thing }),
      apiRequest('/v1/staff/things', { schema: thing }),
      apiRequest('/v1/staff/things', { schema: thing }),
    ]);

    // A second renewal would send a swapped refresh token, and the API
    // would end the whole session.
    expect(api.to('POST', '/v1/staff/auth/refresh')).toHaveLength(1);
  });

  it('takes its turn through the Web Locks API, so tabs never renew together', async () => {
    const request = vi.fn((_name: string, task: () => Promise<unknown>) =>
      task(),
    );
    vi.stubGlobal('navigator', { locks: { request } });
    fakeApi({ [REFRESH]: () => json(200, tokens('t2')) });

    await expect(renewSession()).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith(
      'herbal-staff-refresh',
      expect.any(Function),
    );
  });

  it('ends the session when the cookie cannot renew it any more', async () => {
    fakeApi({
      'GET /v1/staff/things': () =>
        json(401, { message: 'Invalid or expired access token' }),
      [REFRESH]: () => json(401, { message: 'Invalid refresh token' }),
    });
    const lost = vi.fn();
    const stop = onSessionLost(lost);
    setAccessToken('t1');

    const error = await apiRequest('/v1/staff/things', { schema: thing }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(accessToken()).toBeNull();
    stop();
  });

  it('does not try to renew when no access token was sent', async () => {
    const api = fakeApi({
      'POST /v1/staff/auth/login': () =>
        json(401, { message: 'Invalid email, password or code' }),
    });

    await expect(
      apiRequest('/v1/staff/auth/login', {
        method: 'POST',
        body: {},
        anonymous: true,
      }),
    ).rejects.toMatchObject({
      status: 401,
      message: 'Invalid email, password or code',
    });
    expect(api.sent).toHaveLength(1);
  });

  it("reads the API's refusals: the message, the code, the fields and the wait", async () => {
    fakeApi({
      'POST /v1/staff/auth/login': [
        () =>
          json(
            429,
            {
              message: 'Too many requests. Please try again later.',
              code: 'RATE_LIMITED',
            },
            { 'Retry-After': '90' },
          ),
        () =>
          json(400, {
            message: 'Validation failed',
            errors: [{ field: 'code', message: 'The code must be 6 digits' }],
          }),
      ],
    });
    const login = () =>
      apiRequest('/v1/staff/auth/login', {
        method: 'POST',
        body: {},
        anonymous: true,
      });

    await expect(login()).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 90,
    });
    await expect(login()).rejects.toMatchObject({
      status: 400,
      fieldErrors: [{ field: 'code', message: 'The code must be 6 digits' }],
    });
  });

  it('says so when the server cannot be reached', async () => {
    fakeApi({ 'GET /v1/staff/things': offline });
    setAccessToken('t1');

    await expect(
      apiRequest('/v1/staff/things', { schema: thing }),
    ).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("can't reach the server"),
    });
  });

  it('refuses an answer that is not the shape it expects', async () => {
    fakeApi({ 'GET /v1/staff/things': () => json(200, { name: 42 }) });
    setAccessToken('t1');

    await expect(
      apiRequest('/v1/staff/things', { schema: thing }),
    ).rejects.toThrow('does not understand');
  });
});
