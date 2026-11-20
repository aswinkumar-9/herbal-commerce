import {
  acceptInviteSchema,
  adminInviteSchema,
  adminStatusSchema,
  auditLogQuerySchema,
  resetAuthenticatorSchema,
  setupLinkSchema,
  staffLoginSchema,
  superUserSchema,
} from './staff.schemas';

describe('superUserSchema', () => {
  const valid = {
    email: ' Super@Example.com ',
    fullName: ' Dev Super ',
    password: 'a-staff-pass-16ch',
  };

  it('normalises the email and the name', () => {
    const parsed = superUserSchema.parse(valid);
    expect(parsed.email).toBe('super@example.com');
    expect(parsed.fullName).toBe('Dev Super');
  });

  it('requires a staff password of 16 to 128 characters', () => {
    const withPassword = (password: string) =>
      superUserSchema.safeParse({ ...valid, password }).success;
    expect(withPassword('x'.repeat(15))).toBe(false);
    expect(withPassword('x'.repeat(16))).toBe(true);
    expect(withPassword('x'.repeat(129))).toBe(false);
  });
});

describe('staffLoginSchema', () => {
  const valid = {
    email: ' Dev.Admin@Example.com ',
    password: 'a-staff-pass-16ch',
    code: ' 123456 ',
  };

  it('normalises the email and trims the code', () => {
    const parsed = staffLoginSchema.parse(valid);
    expect(parsed.email).toBe('dev.admin@example.com');
    expect(parsed.code).toBe('123456');
  });

  it('accepts only a 6-digit code and checks only the password length', () => {
    const accepts = (changes: object) =>
      staffLoginSchema.safeParse({ ...valid, ...changes }).success;
    for (const code of ['12345', '1234567', 'abcdef', '123 456', '']) {
      expect(accepts({ code })).toBe(false);
    }
    expect(accepts({ code: undefined })).toBe(false);
    expect(accepts({ password: '' })).toBe(false);
    expect(accepts({ password: 'short' })).toBe(true);
    expect(accepts({ password: 'x'.repeat(129) })).toBe(false);
  });
});

describe('adminInviteSchema', () => {
  it('takes only the email and the name, normalised', () => {
    const parsed = adminInviteSchema.parse({
      email: ' Dev.Admin1@Example.com ',
      fullName: ' Dev Admin ',
      role: 'SUPER_USER',
      password: 'chosen-by-someone-else',
    });
    expect(parsed).toEqual({
      email: 'dev.admin1@example.com',
      fullName: 'Dev Admin',
    });
  });

  it('requires a valid email and a name', () => {
    expect(adminInviteSchema.safeParse({ fullName: 'Dev Admin' }).success).toBe(
      false,
    );
    expect(
      adminInviteSchema.safeParse({ email: 'not-an-email', fullName: 'Dev Admin' })
        .success,
    ).toBe(false);
    expect(
      adminInviteSchema.safeParse({ email: 'a@example.com', fullName: ' ' })
        .success,
    ).toBe(false);
  });
});

describe('acceptInviteSchema', () => {
  const valid = {
    token: 'x'.repeat(43),
    password: 'a-staff-pass-16ch',
    code: ' 287082 ',
  };

  it('requires the code the authenticator app shows, 6 digits, spaces around them trimmed (ADR 0038)', () => {
    const accepts = (changes: object) =>
      acceptInviteSchema.safeParse({ ...valid, ...changes }).success;
    expect(acceptInviteSchema.parse(valid).code).toBe('287082');
    expect(accepts({ code: undefined })).toBe(false);
    expect(accepts({ code: '28708' })).toBe(false);
    expect(accepts({ code: '28708a' })).toBe(false);
  });

  it('requires the token from the link', () => {
    const accepts = (changes: object) =>
      acceptInviteSchema.safeParse({ ...valid, ...changes }).success;
    expect(accepts({})).toBe(true);
    expect(accepts({ token: undefined })).toBe(false);
    expect(accepts({ token: 'too-short' })).toBe(false);
  });

  it('requires a staff password of 16 to 128 characters', () => {
    const withPassword = (password: string) =>
      acceptInviteSchema.safeParse({ ...valid, password }).success;
    expect(withPassword('x'.repeat(15))).toBe(false);
    expect(withPassword('x'.repeat(16))).toBe(true);
    expect(withPassword('x'.repeat(129))).toBe(false);
  });
});

describe('adminStatusSchema', () => {
  it('takes only ACTIVE or DISABLED, and nothing else about the account', () => {
    expect(
      adminStatusSchema.parse({ status: 'DISABLED', role: 'SUPER_USER' }),
    ).toEqual({ status: 'DISABLED' });
    expect(adminStatusSchema.parse({ status: 'ACTIVE' })).toEqual({
      status: 'ACTIVE',
    });
    for (const status of ['disabled', 'REMOVED', '', undefined]) {
      expect(adminStatusSchema.safeParse({ status }).success).toBe(false);
    }
  });
});

describe('auditLogQuerySchema', () => {
  const accepts = (query: object) =>
    auditLogQuerySchema.safeParse(query).success;

  it('pages 50 entries by default, and turns the limit from text into a number', () => {
    expect(auditLogQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(auditLogQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
  });

  it('takes a whole limit from 1 to 100 only', () => {
    for (const limit of ['', '0', '101', '2.5', 'ten', ['5', '6']]) {
      expect(accepts({ limit })).toBe(false);
    }
    expect(accepts({ limit: '1' })).toBe(true);
    expect(accepts({ limit: '100' })).toBe(true);
  });

  it('checks the cursor and the filters, and drops anything else', () => {
    const id = '3c9a7e21-5b4d-4f8e-9a16-7d2e0c5b8f41';
    expect(
      auditLogQuerySchema.parse({
        before: id,
        action: 'admin.removed',
        actorId: id,
        targetId: id,
        orderBy: 'ip',
      }),
    ).toEqual({
      limit: 50,
      before: id,
      action: 'admin.removed',
      actorId: id,
      targetId: id,
    });
    expect(accepts({ before: 'entry-1' })).toBe(false);
    expect(accepts({ actorId: 'nobody' })).toBe(false);
    expect(accepts({ action: 'Admin.Removed' })).toBe(false);
    expect(accepts({ action: 'admin' })).toBe(false);
    expect(accepts({ targetId: '' })).toBe(false);
    expect(accepts({ targetId: 'x'.repeat(101) })).toBe(false);
  });

  it('takes one kind of change, from the kinds there are (ADR 0038)', () => {
    for (const kind of ['accounts', 'sign_ins', 'orders', 'catalog', 'stock']) {
      expect(auditLogQuerySchema.parse({ kind })).toEqual({ limit: 50, kind });
    }
    for (const kind of ['', 'Orders', 'order', 'payments', ['orders']]) {
      expect(accepts({ kind })).toBe(false);
    }
  });
});


describe('setupLinkSchema and resetAuthenticatorSchema (ADR 0038)', () => {
  it('asks for the key with the token from the link alone', () => {
    expect(setupLinkSchema.safeParse({ token: 'x'.repeat(43) }).success).toBe(
      true,
    );
    expect(setupLinkSchema.safeParse({ token: 'too-short' }).success).toBe(
      false,
    );
  });

  it('sets the app up again with the link, any password of the right length, and a code', () => {
    const valid = { token: 'x'.repeat(43), password: 'old', code: '287082' };
    const accepts = (changes: object) =>
      resetAuthenticatorSchema.safeParse({ ...valid, ...changes }).success;
    // The password is checked, not chosen: an older, shorter one works.
    expect(accepts({})).toBe(true);
    expect(accepts({ password: '' })).toBe(false);
    expect(accepts({ password: 'x'.repeat(129) })).toBe(false);
    expect(accepts({ code: '12345' })).toBe(false);
    expect(accepts({ token: undefined })).toBe(false);
  });
});
