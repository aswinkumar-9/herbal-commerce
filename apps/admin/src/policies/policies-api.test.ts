import { describe, expect, it } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { ApiError } from '../api/api-error';
import { fakeApi, json } from '../test/fake-api';
import {
  DISCARD,
  POLICIES,
  POLICY,
  PUBLISH,
  SAVE,
  V1,
  V2,
  VERSION,
  VERSIONS,
  answer,
  detailOf,
  summariesOf,
} from '../test/policy-fixtures';
import {
  discardDraft,
  getPolicyPage,
  getVersion,
  listPolicyPages,
  listVersions,
  publishPolicy,
  saveDraft,
} from './policies-api';

const NOT_UNDERSTOOD =
  'The server sent an answer the console does not understand.';

describe('the policy pages API', () => {
  it('lists the pages and reads one, with the access token', async () => {
    setAccessToken('t1');
    const api = fakeApi({
      [POLICIES]: summariesOf({ privacy: { revision: 4, published: V2 } }),
      [POLICY('privacy')]: answer(detailOf()),
    });

    const pages = await listPolicyPages();
    expect(pages.map((page) => page.page)).toEqual([
      'privacy',
      'terms',
      'refunds',
      'shipping',
      'contact',
    ]);
    expect(pages[0]).toEqual({
      page: 'privacy',
      revision: 4,
      draft: null,
      published: V2,
    });
    await expect(getPolicyPage('privacy')).resolves.toEqual(detailOf());
    expect(api.sent.every((r) => r.authorization === 'Bearer t1')).toBe(true);
  });

  it('refuses an answer for a page it does not know, or with a wrong date', async () => {
    setAccessToken('t1');
    fakeApi({
      [POLICY('privacy')]: [
        answer({ ...detailOf(), page: 'cookies' }),
        answer(
          detailOf({ published: { ...V2, publishedAt: 'today', body: 'x' } }),
        ),
        answer({ ...detailOf(), revision: -1 }),
      ],
    });

    for (let tries = 0; tries < 3; tries += 1) {
      await expect(getPolicyPage('privacy')).rejects.toThrow(NOT_UNDERSTOOD);
    }
  });

  it('saves the draft with the revision it was written on', async () => {
    setAccessToken('t1');
    const api = fakeApi({
      [SAVE('terms')]: answer(detailOf({ page: 'terms' })),
    });

    await saveDraft('terms', '## Terms', 7);

    expect(api.to('PUT', '/v1/staff/policies/terms/draft')[0]?.body).toEqual({
      body: '## Terms',
      revision: 7,
    });
  });

  it('discards and publishes on a revision, and says why when refused', async () => {
    setAccessToken('t1');
    const api = fakeApi({
      [DISCARD('refunds', 3)]: answer(
        detailOf({ page: 'refunds', draft: null }),
      ),
      [PUBLISH('refunds')]: () =>
        json(409, { message: 'There is no draft to publish.' }),
    });

    await discardDraft('refunds', 3);
    const refused = await publishPolicy('refunds', 4).catch(
      (error: unknown) => error,
    );

    expect(
      api.to('DELETE', '/v1/staff/policies/refunds/draft?revision=3'),
    ).toHaveLength(1);
    expect(
      api.to('POST', '/v1/staff/policies/refunds/publish')[0]?.body,
    ).toEqual({
      revision: 4,
    });
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({
      status: 409,
      message: 'There is no draft to publish.',
    });
  });

  it('lists the versions and reads one with its text', async () => {
    setAccessToken('t1');
    fakeApi({
      [VERSIONS('privacy')]: answer({ versions: [V2, V1] }),
      [VERSION('privacy', 1)]: answer({
        ...V1,
        page: 'privacy',
        body: 'First',
      }),
    });

    await expect(listVersions('privacy')).resolves.toEqual([V2, V1]);
    await expect(getVersion('privacy', 1)).resolves.toEqual({
      ...V1,
      page: 'privacy',
      body: 'First',
    });
  });
});
