import { z } from 'zod';
import { apiRequest } from '../api/client';
import { POLICY_PAGES } from './policy-pages';
import type { PolicyPageName } from './policy-pages';

// The policy pages API, for Super Users only (ADR 0040): every page, one
// page with its draft, saving and discarding the draft, publishing it, and
// the versions customers have been shown. Every answer is checked against
// these shapes.

const POLICIES = '/v1/staff/policies';
const moment = z.iso.datetime();

// The longest text a page holds, as the API counts it.
export const POLICY_MAX_LENGTH = 30_000;

const person = z.object({ id: z.string(), fullName: z.string() });
const pageName = z.enum(POLICY_PAGES);
const revision = z.number().int().min(0);

const versionSummarySchema = z.object({
  version: z.number().int().positive(),
  publishedAt: moment,
  publishedBy: person,
});
export type PolicyVersionSummary = z.infer<typeof versionSummarySchema>;

const summarySchema = z.object({
  page: pageName,
  revision,
  draft: z.object({ updatedAt: moment, updatedBy: person }).nullable(),
  published: versionSummarySchema.nullable(),
});
export type PolicyPageSummary = z.infer<typeof summarySchema>;
const listSchema = z.object({ pages: z.array(summarySchema) });

const detailSchema = z.object({
  page: pageName,
  revision,
  draft: z
    .object({ body: z.string(), updatedAt: moment, updatedBy: person })
    .nullable(),
  published: versionSummarySchema.extend({ body: z.string() }).nullable(),
});
export type PolicyPageDetail = z.infer<typeof detailSchema>;

const versionsSchema = z.object({ versions: z.array(versionSummarySchema) });
const versionSchema = versionSummarySchema.extend({
  page: pageName,
  body: z.string(),
});
export type PolicyVersion = z.infer<typeof versionSchema>;

export async function listPolicyPages(
  signal?: AbortSignal,
): Promise<PolicyPageSummary[]> {
  const { pages } = await apiRequest(POLICIES, { schema: listSchema, signal });
  return pages;
}

export function getPolicyPage(
  page: PolicyPageName,
  signal?: AbortSignal,
): Promise<PolicyPageDetail> {
  return apiRequest(`${POLICIES}/${page}`, { schema: detailSchema, signal });
}

// Saves the draft, on the revision it was written on: a change saved
// meanwhile by someone else answers 409.
export function saveDraft(
  page: PolicyPageName,
  body: string,
  onRevision: number,
): Promise<PolicyPageDetail> {
  return apiRequest(`${POLICIES}/${page}/draft`, {
    method: 'PUT',
    body: { body, revision: onRevision },
    schema: detailSchema,
  });
}

export function discardDraft(
  page: PolicyPageName,
  onRevision: number,
): Promise<PolicyPageDetail> {
  return apiRequest(`${POLICIES}/${page}/draft?revision=${onRevision}`, {
    method: 'DELETE',
    schema: detailSchema,
  });
}

// Puts the saved draft on the website, exactly as it was on that revision.
export function publishPolicy(
  page: PolicyPageName,
  onRevision: number,
): Promise<PolicyPageDetail> {
  return apiRequest(`${POLICIES}/${page}/publish`, {
    method: 'POST',
    body: { revision: onRevision },
    schema: detailSchema,
  });
}

export async function listVersions(
  page: PolicyPageName,
  signal?: AbortSignal,
): Promise<PolicyVersionSummary[]> {
  const { versions } = await apiRequest(`${POLICIES}/${page}/versions`, {
    schema: versionsSchema,
    signal,
  });
  return versions;
}

export function getVersion(
  page: PolicyPageName,
  version: number,
  signal?: AbortSignal,
): Promise<PolicyVersion> {
  return apiRequest(`${POLICIES}/${page}/versions/${version}`, {
    schema: versionSchema,
    signal,
  });
}
