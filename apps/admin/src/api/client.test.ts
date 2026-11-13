import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fakeApi, json, offline, tokens } from '../test/fake-api';
import { accessToken, setAccessToken } from './access-token';
import { ApiError } from './api-error';
import { apiRequest, apiUpload, onSessionLost, renewSession } from './client';

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

describe('an upload', () => {
  const UPLOAD = 'POST /v1/staff/things/files';
  const PATH = '/v1/staff/things/files';
  const photo = () =>
    new File(['0123456789'], 'tulsi.jpg', { type: 'image/jpeg' });

  // An answer the test gives when it is ready.
  function heldBack() {
    let give: (response: Response) => void = () => undefined;
    const answer = new Promise<Response>((resolve) => {
      give = resolve;
    });
    return {
      answer: () => answer,
      give: (response: Response) => give(response),
    };
  }

  it('sends the file itself, with its type and the access token, and says how much has gone', async () => {
    const api = fakeApi({ [UPLOAD]: () => json(201, { name: 'tulsi' }) });
    setAccessToken('t1');
    const file = photo();
    const progress = vi.fn();

    await expect(
      apiUpload(PATH, file, { schema: thing, onProgress: progress }),
    ).resolves.toEqual({ name: 'tulsi' });

    const [request] = api.sent;
    expect(request?.body).toBe(file);
    expect(request?.authorization).toBe('Bearer t1');
    const headers = new Headers(request?.init.headers);
    expect(headers.get('Content-Type')).toBe('image/jpeg');
    expect(headers.get('Accept')).toBe('application/json');
    expect(progress.mock.calls).toEqual([[0.5], [1]]);
  });

  it('refuses to send anything outside the API', async () => {
    const api = fakeApi({});
    setAccessToken('t1');

    for (const path of ['https://elsewhere.example/v1/x', '/media/x']) {
      await expect(apiUpload(path, photo(), { schema: thing })).rejects.toThrow(
        'Not an API path',
      );
    }
    expect(api.sent).toHaveLength(0);
  });

  it('renews an expired access token once, and sends the file again', async () => {
    const api = fakeApi({
      [UPLOAD]: [
        () => json(401, { message: 'Invalid or expired access token' }),
        () => json(201, { name: 'tulsi' }),
      ],
      [REFRESH]: () => json(200, tokens('t2')),
    });
    setAccessToken('t1');
    const file = photo();

    await expect(apiUpload(PATH, file, { schema: thing })).resolves.toEqual({
      name: 'tulsi',
    });

    expect(api.sent.map((r) => [r.method, r.path, r.authorization])).toEqual([
      ['POST', PATH, 'Bearer t1'],
      ['POST', '/v1/staff/auth/refresh', null],
      ['POST', PATH, 'Bearer t2'],
    ]);
    expect(api.sent[2]?.body).toBe(file);
  });

  it('ends the session when the cookie cannot renew it any more', async () => {
    fakeApi({
      [UPLOAD]: () => json(401, { message: 'Invalid or expired access token' }),
      [REFRESH]: () => json(401, { message: 'Invalid refresh token' }),
    });
    const lost = vi.fn();
    const stop = onSessionLost(lost);
    setAccessToken('t1');

    await expect(
      apiUpload(PATH, photo(), { schema: thing }),
    ).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reads the API's refusals, with the wait", async () => {
    fakeApi({
      [UPLOAD]: [
        () =>
          json(
            429,
            { message: 'Too many requests. Please try again later.' },
            { 'Retry-After': '120' },
          ),
        () =>
          json(400, {
            message: 'Validation failed',
            errors: [
              {
                field: 'file',
                message: 'The image needs at least 400 pixels on each side',
              },
            ],
          }),
      ],
    });
    setAccessToken('t1');
    const send = () => apiUpload(PATH, photo(), { schema: thing });

    await expect(send()).rejects.toMatchObject({
      status: 429,
      message: 'Too many requests. Please try again later.',
      retryAfterSeconds: 120,
    });
    await expect(send()).rejects.toMatchObject({
      status: 400,
      fieldErrors: [
        {
          field: 'file',
          message: 'The image needs at least 400 pixels on each side',
        },
      ],
    });
  });

  it('says so when the server cannot be reached', async () => {
    fakeApi({ [UPLOAD]: offline });
    setAccessToken('t1');

    await expect(
      apiUpload(PATH, photo(), { schema: thing }),
    ).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("can't reach the server"),
    });
  });

  it('refuses an answer that is not the shape it expects', async () => {
    fakeApi({ [UPLOAD]: () => json(201, { name: 42 }) });
    setAccessToken('t1');

    await expect(apiUpload(PATH, photo(), { schema: thing })).rejects.toThrow(
      'does not understand',
    );
  });

  it('stops when it is called off, half way or before it starts', async () => {
    const held = heldBack();
    const api = fakeApi({ [UPLOAD]: held.answer });
    setAccessToken('t1');
    const progress = vi.fn();
    const halfWay = new AbortController();

    const sending = apiUpload(PATH, photo(), {
      schema: thing,
      onProgress: progress,
      signal: halfWay.signal,
    });
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(0.5));
    halfWay.abort();
    held.give(json(201, { name: 'tulsi' }));

    await expect(sending).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).not.toHaveBeenCalledWith(1);

    const before = new AbortController();
    before.abort();
    await expect(
      apiUpload(PATH, photo(), { schema: thing, signal: before.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.sent).toHaveLength(1);
  });
});
