import {
  discardQuerySchema,
  POLICY_MAX_LENGTH,
  publishSchema,
  saveDraftSchema,
  versionParamSchema,
} from './policies.schemas';
import { POLICY_PAGES, policyKindOf, policyPageOf } from './policy-pages';

describe('the policy pages', () => {
  it('are the five pages, in the order the website lists them', () => {
    expect(POLICY_PAGES).toEqual([
      'privacy',
      'terms',
      'refunds',
      'shipping',
      'contact',
    ]);
    expect(POLICY_PAGES.map((page) => policyKindOf(page))).toEqual([
      'PRIVACY',
      'TERMS',
      'REFUNDS',
      'SHIPPING',
      'CONTACT',
    ]);
    for (const page of POLICY_PAGES) {
      expect(policyPageOf(policyKindOf(page)!)).toBe(page);
    }
  });

  it('know no other word, not even one every object has', () => {
    for (const word of [
      'PRIVACY',
      'Privacy',
      'about',
      '',
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
    ]) {
      expect([word, policyKindOf(word)]).toEqual([word, undefined]);
    }
  });
});

describe('saveDraftSchema', () => {
  const save = (body: string, revision: unknown = 0) =>
    saveDraftSchema.safeParse({ body, revision });

  it('keeps the text, with Unix line ends and nothing blank at its ends', () => {
    const parsed = saveDraftSchema.parse({
      body: '\n\n  ## Who we are\r\n\r\nWe are a shop.\rLine two.\t\n\n  \n',
      revision: 3,
    });
    expect(parsed).toEqual({
      body: '## Who we are\n\nWe are a shop.\nLine two.',
      revision: 3,
    });
  });

  it('keeps spaces and tabs inside the text', () => {
    expect(save('- one\n\t- two\n  indented').data?.body).toBe(
      '- one\n\t- two\n  indented',
    );
  });

  it('refuses an empty text, or one of only spaces and line ends', () => {
    for (const body of ['', '   ', '\r\n\t\n']) {
      expect(save(body).success).toBe(false);
    }
    expect(saveDraftSchema.safeParse({ revision: 0 }).success).toBe(false);
  });

  it(`holds at most ${POLICY_MAX_LENGTH} characters, counted after cleaning`, () => {
    expect(save('a'.repeat(POLICY_MAX_LENGTH)).success).toBe(true);
    expect(save(`  ${'a'.repeat(POLICY_MAX_LENGTH)}\n\n`).success).toBe(true);
    expect(save('a'.repeat(POLICY_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('fits the request limit at its longest, even in Hindi', () => {
    const body = 'अ'.repeat(POLICY_MAX_LENGTH);
    const bytes = Buffer.byteLength(JSON.stringify({ body, revision: 1 }));
    expect(bytes).toBeLessThan(100 * 1024);
  });

  it('refuses hidden control characters, but not tabs or line ends', () => {
    for (const hidden of [
      '\u0000',
      '\u0007',
      '\u000B',
      '\u001B',
      '\u007F',
      '\u0085',
    ]) {
      const parsed = save(`Text${hidden}here`);
      expect([JSON.stringify(hidden), parsed.success]).toEqual([
        JSON.stringify(hidden),
        false,
      ]);
    }
    expect(save('Tab\there\nand a line').success).toBe(true);
  });

  it('takes Hindi, accents and symbols as they are', () => {
    expect(save('गोपनीयता नीति · Café · ₹499').data?.body).toBe(
      'गोपनीयता नीति · Café · ₹499',
    );
  });

  it('needs the revision it was written on, a whole number from 0', () => {
    expect(save('Text', 0).success).toBe(true);
    expect(save('Text', 2_147_483_647).success).toBe(true);
    for (const revision of [-1, 1.5, '3', null, undefined, 2_147_483_648]) {
      const parsed = saveDraftSchema.safeParse({ body: 'Text', revision });
      expect([revision, parsed.success]).toEqual([revision, false]);
    }
  });
});

describe('publishSchema', () => {
  it('needs the revision that was previewed', () => {
    expect(publishSchema.parse({ revision: 4 })).toEqual({ revision: 4 });
    expect(publishSchema.safeParse({}).success).toBe(false);
    expect(publishSchema.safeParse({ revision: '4' }).success).toBe(false);
  });
});

describe('discardQuerySchema', () => {
  it('reads the revision from the address', () => {
    expect(discardQuerySchema.parse({ revision: '3' })).toEqual({
      revision: 3,
    });
    expect(discardQuerySchema.parse({ revision: '0' })).toEqual({
      revision: 0,
    });
  });

  it('refuses anything but a whole number a Postgres integer holds', () => {
    for (const revision of [
      '',
      'abc',
      '-1',
      '1.5',
      '1e3',
      '99999999999',
      undefined,
    ]) {
      expect([
        revision,
        discardQuerySchema.safeParse({ revision }).success,
      ]).toEqual([revision, false]);
    }
    expect(discardQuerySchema.safeParse({ revision: ['1', '2'] }).success).toBe(
      false,
    );
  });
});

describe('versionParamSchema', () => {
  it('reads a version number from 1', () => {
    expect(versionParamSchema.parse('1')).toBe(1);
    expect(versionParamSchema.parse('123456789')).toBe(123456789);
  });

  it('refuses 0, leading zeros, and anything else', () => {
    for (const version of ['0', '01', '1.0', '-1', 'x', '', '1234567890']) {
      expect([version, versionParamSchema.safeParse(version).success]).toEqual([
        version,
        false,
      ]);
    }
  });
});
