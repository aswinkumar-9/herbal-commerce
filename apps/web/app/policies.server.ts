// A policy page's published text, from the API (ADR 0040). A page the
// Super User has not published yet is no error: the page says it is still
// being written.
import { z } from 'zod';
import { apiFind, segment } from './api.server.ts';
import { POLICY_PAGES } from './policy-pages.ts';
import type { PolicyPage } from './policy-pages.ts';

// The longest text the API keeps for a page.
const POLICY_MAX_LENGTH = 30_000;

const policySchema = z.object({
  page: z.enum(POLICY_PAGES),
  version: z.number().int().positive(),
  body: z.string().min(1).max(POLICY_MAX_LENGTH),
  publishedAt: z.iso.datetime(),
});

export interface Policy {
  body: string;
  // When it was published, and that day in India, as customers read it.
  publishedAt: string;
  publishedOn: string;
}

const DAY_IN_INDIA = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});

export async function getPolicy(
  request: Request,
  page: PolicyPage,
): Promise<Policy | null> {
  const found = await apiFind(
    request,
    `policies/${segment(page)}`,
    policySchema,
  );
  if (!found) {
    return null;
  }
  return {
    body: found.body,
    publishedAt: found.publishedAt,
    // Made here, on the server, so the page reads the same once it runs in
    // the browser.
    publishedOn: DAY_IN_INDIA.format(new Date(found.publishedAt)),
  };
}
