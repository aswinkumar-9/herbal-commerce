import type {
  PolicyPageDetail,
  PolicyPageSummary,
  PolicyVersionSummary,
} from '../policies/policies-api';
import { json } from './fake-api';

// The policy pages as the API sends them (ADR 0040).

export const POLICIES = 'GET /v1/staff/policies';
export const POLICY = (page: string) => `GET /v1/staff/policies/${page}`;
export const SAVE = (page: string) => `PUT /v1/staff/policies/${page}/draft`;
export const DISCARD = (page: string, revision: number) =>
  `DELETE /v1/staff/policies/${page}/draft?revision=${revision}`;
export const PUBLISH = (page: string) =>
  `POST /v1/staff/policies/${page}/publish`;
export const VERSIONS = (page: string) =>
  `GET /v1/staff/policies/${page}/versions`;
export const VERSION = (page: string, version: number) =>
  `GET /v1/staff/policies/${page}/versions/${version}`;

export const RAVI_REF = { id: 'staff-2', fullName: 'Ravi Kumar' };
export const MEERA_REF = { id: 'staff-9', fullName: 'Meera Rao' };

export const LIVE_TEXT = '## Who we are\n\nWe sell herbs.';
export const DRAFT_TEXT =
  '## Who we are\n\nWe grow and sell herbs.\n\n## What we keep\n- Your name\n- Your address';

// 15:35 on 21 Nov 2026 in India.
export const V2: PolicyVersionSummary = {
  version: 2,
  publishedAt: '2026-11-21T10:05:00.000Z',
  publishedBy: RAVI_REF,
};
// 10:00 on 20 Nov 2026 in India.
export const V1: PolicyVersionSummary = {
  version: 1,
  publishedAt: '2026-11-20T04:30:00.000Z',
  publishedBy: MEERA_REF,
};
// 17:00 on 21 Nov 2026 in India.
export const SAVED_AT = '2026-11-21T11:30:00.000Z';

// The privacy policy, on the website as version 2, with a draft waiting.
export function detailOf(
  changes: Partial<PolicyPageDetail> = {},
): PolicyPageDetail {
  return {
    page: 'privacy',
    revision: 4,
    draft: { body: DRAFT_TEXT, updatedAt: SAVED_AT, updatedBy: RAVI_REF },
    published: { ...V2, body: LIVE_TEXT },
    ...changes,
  };
}

export const NEVER_WRITTEN = (page: PolicyPageDetail['page']) =>
  detailOf({ page, revision: 0, draft: null, published: null });

export function summariesOf(
  pages: Partial<Record<PolicyPageSummary['page'], Partial<PolicyPageSummary>>>,
): () => Response {
  const all = (
    ['privacy', 'terms', 'refunds', 'shipping', 'contact'] as const
  ).map((page): PolicyPageSummary => ({
    page,
    revision: 0,
    draft: null,
    published: null,
    ...pages[page],
  }));
  return () => json(200, { pages: all });
}

export const answer =
  (body: unknown, status = 200) =>
  () =>
    json(status, body);
