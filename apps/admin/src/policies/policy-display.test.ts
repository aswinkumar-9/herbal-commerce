import { describe, expect, it } from 'vitest';
import { RAVI_REF, SAVED_AT, V2 } from '../test/policy-fixtures';
import {
  cleanText,
  draftLine,
  policyState,
  publishedLine,
  whenInIndia,
} from './policy-display';
import { isPolicyPage } from './policy-pages';

const draft = { updatedAt: SAVED_AT, updatedBy: RAVI_REF };

describe('where a policy page stands', () => {
  it('is not written, a draft only, on the website, or on it with changes waiting', () => {
    expect(policyState({ draft: null, published: null })).toBe('NOT_WRITTEN');
    expect(policyState({ draft, published: null })).toBe('DRAFT_ONLY');
    expect(policyState({ draft: null, published: V2 })).toBe('PUBLISHED');
    expect(policyState({ draft, published: V2 })).toBe('DRAFT_WAITING');
  });

  it('says when and by whom, in India', () => {
    expect(whenInIndia('2026-11-21T10:05:00.000Z')).toBe(
      '21 Nov 2026 at 15:35',
    );
    // Past midnight in India, still the day before in UTC.
    expect(whenInIndia('2026-11-21T19:00:00.000Z')).toBe(
      '22 Nov 2026 at 00:30',
    );
    expect(publishedLine(V2)).toBe(
      'Version 2, published 21 Nov 2026 at 15:35 by Ravi Kumar.',
    );
    expect(draftLine(draft)).toBe(
      'Draft saved 21 Nov 2026 at 17:00 by Ravi Kumar.',
    );
  });
});

describe('cleanText', () => {
  it('cleans a text as the API does: Unix line ends, nothing blank at its ends', () => {
    expect(cleanText('\n  ## A\r\n\r\nB\rC \t\n\n')).toBe('## A\n\nB\nC');
    expect(cleanText('  inner  spaces\tstay  ')).toBe('inner  spaces\tstay');
    expect(cleanText(' \n\t')).toBe('');
  });
});

describe('isPolicyPage', () => {
  it('knows the five pages, and no other word', () => {
    for (const page of ['privacy', 'terms', 'refunds', 'shipping', 'contact']) {
      expect(isPolicyPage(page)).toBe(true);
    }
    for (const word of [
      undefined,
      '',
      'Privacy',
      'cookies',
      'constructor',
      '__proto__',
    ]) {
      expect([word, isPolicyPage(word)]).toEqual([word, false]);
    }
  });
});
