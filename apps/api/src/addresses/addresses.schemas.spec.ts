import {
  addressSchema,
  addressUpdateSchema,
  INDIAN_STATES,
} from './addresses.schemas';

const valid = {
  fullName: ' Asha K ',
  phone: '9845012345',
  line1: ' 12, 3rd Cross, Indiranagar ',
  city: ' Bengaluru ',
  state: 'Karnataka',
  pincode: '560038',
};

const accepts = (changes: object) =>
  addressSchema.safeParse({ ...valid, ...changes }).success;

describe('addressSchema', () => {
  it('trims every text field, and ignores a userId or anything else', () => {
    expect(
      addressSchema.parse({ ...valid, userId: 'someone-else', role: 'ADMIN' }),
    ).toEqual({
      fullName: 'Asha K',
      phone: '9845012345',
      line1: '12, 3rd Cross, Indiranagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
    });
  });

  it('stores a mobile number as 10 digits, however it is written', () => {
    for (const written of [
      '9845012345',
      ' 98450 12345 ',
      '+91 98450 12345',
      '+91-98450-12345',
      '919845012345',
      '098450-12345',
    ]) {
      expect([written, addressSchema.parse({ ...valid, phone: written }).phone])
        .toEqual([written, '9845012345']);
    }
  });

  it('refuses anything that is not an Indian mobile number', () => {
    for (const phone of [
      '5845012345',
      '98450123',
      '98450123456',
      '+1 415 555 0100',
      'call me',
      '9'.repeat(21),
    ]) {
      expect([phone, accepts({ phone })]).toEqual([phone, false]);
    }
  });

  it('takes a 6-digit PIN code that does not start with 0', () => {
    expect(addressSchema.parse({ ...valid, pincode: '560 038' }).pincode).toBe(
      '560038',
    );
    for (const pincode of ['060038', '56003', '5600381', 'abcdef', '']) {
      expect([pincode, accepts({ pincode })]).toEqual([pincode, false]);
    }
  });

  it('takes a state or union territory only from the list, spelled exactly', () => {
    expect(INDIAN_STATES).toHaveLength(36);
    expect(new Set(INDIAN_STATES).size).toBe(36);
    for (const state of INDIAN_STATES) {
      expect(accepts({ state })).toBe(true);
    }
    for (const state of ['karnataka', 'Karnatka', 'Bangalore', '']) {
      expect([state, accepts({ state })]).toEqual([state, false]);
    }
  });

  it('needs every field but the second line, and treats an empty second line as none', () => {
    const required = ['fullName', 'phone', 'line1', 'city', 'state', 'pincode'];
    for (const missing of required) {
      const rest: Record<string, unknown> = { ...valid };
      delete rest[missing];
      expect([missing, addressSchema.safeParse(rest).success]).toEqual([
        missing,
        false,
      ]);
    }
    expect(accepts({ line1: '   ' })).toBe(false);
    expect(accepts({ line1: 'x'.repeat(201) })).toBe(false);
    expect(addressSchema.parse({ ...valid, line2: '  ' }).line2).toBeNull();
    expect(
      addressSchema.parse({ ...valid, line2: ' Near the park ' }).line2,
    ).toBe('Near the park');
    expect(accepts({ line2: 'x'.repeat(201) })).toBe(false);
  });

  it('can make the new address the default', () => {
    expect(addressSchema.parse({ ...valid, isDefault: true }).isDefault).toBe(
      true,
    );
    expect(accepts({ isDefault: 'yes' })).toBe(false);
  });
});

describe('addressUpdateSchema', () => {
  it('takes only the fields that change, with the same rules', () => {
    expect(
      addressUpdateSchema.parse({ phone: '+91 98450 12345', userId: 'x' }),
    ).toEqual({ phone: '9845012345' });
    expect(addressUpdateSchema.safeParse({ pincode: '060038' }).success).toBe(
      false,
    );
    expect(addressUpdateSchema.safeParse({ state: 'Bangalore' }).success).toBe(
      false,
    );
  });

  it('clears the second line with null or an empty string', () => {
    expect(addressUpdateSchema.parse({ line2: null })).toEqual({ line2: null });
    expect(addressUpdateSchema.parse({ line2: '' })).toEqual({ line2: null });
  });

  it('can make an address the default, but not take it away', () => {
    expect(addressUpdateSchema.parse({ isDefault: true })).toEqual({
      isDefault: true,
    });
    expect(addressUpdateSchema.safeParse({ isDefault: false }).success).toBe(
      false,
    );
  });

  it('refuses a change with nothing in it', () => {
    expect(addressUpdateSchema.safeParse({}).success).toBe(false);
    expect(addressUpdateSchema.safeParse({ userId: 'x' }).success).toBe(false);
  });
});
