import { dayName } from '../stock/stock-display';
import type { PolicyPageSummary, PolicyVersionSummary } from './policies-api';

// Where a page stands, for its chip in the list.
export type PolicyState =
  'NOT_WRITTEN' | 'DRAFT_ONLY' | 'PUBLISHED' | 'DRAFT_WAITING';

export function policyState({
  draft,
  published,
}: Pick<PolicyPageSummary, 'draft' | 'published'>): PolicyState {
  if (!published) {
    return draft ? 'DRAFT_ONLY' : 'NOT_WRITTEN';
  }
  return draft ? 'DRAFT_WAITING' : 'PUBLISHED';
}

export const POLICY_STATE_NAMES: Record<PolicyState, string> = {
  NOT_WRITTEN: 'Not written yet',
  DRAFT_ONLY: 'Draft, not published',
  PUBLISHED: 'On the website',
  DRAFT_WAITING: 'Changes waiting',
};

export const POLICY_STATE_STYLES: Record<PolicyState, string> = {
  NOT_WRITTEN: 'bg-surface-muted text-ink-muted',
  DRAFT_ONLY: 'bg-warning-soft text-warning',
  PUBLISHED: 'bg-primary-soft text-primary-strong',
  DRAFT_WAITING: 'bg-warning-soft text-warning',
};

// "21 Nov 2026 at 15:35", in India: the shop works in India.
export function whenInIndia(at: string): string {
  const india = new Date(Date.parse(at) + 330 * 60_000).toISOString();
  return `${dayName(india.slice(0, 10))} at ${india.slice(11, 16)}`;
}

// "Version 3, published 21 Nov 2026 at 15:35 by Ravi Kumar."
export function publishedLine(published: PolicyVersionSummary): string {
  return `Version ${published.version}, published ${whenInIndia(published.publishedAt)} by ${published.publishedBy.fullName}.`;
}

// "Draft saved 21 Nov 2026 at 15:35 by Ravi Kumar."
export function draftLine(
  draft: NonNullable<PolicyPageSummary['draft']>,
): string {
  return `Draft saved ${whenInIndia(draft.updatedAt)} by ${draft.updatedBy.fullName}.`;
}

// The text as the API keeps it: Unix line ends, and nothing blank at its
// ends. Two texts that clean the same are the same page.
export function cleanText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^[ \t\n]+|[ \t\n]+$/g, '');
}
