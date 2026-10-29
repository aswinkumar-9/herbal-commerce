import { SecretBox } from './secret-box';

const KEY_MATERIAL = 'test-key-material-'.repeat(3);
const box = new SecretBox(KEY_MATERIAL, 'test secrets');

describe('SecretBox', () => {
  it('opens what it sealed, for the same context', () => {
    const sealed = box.seal('JBSWY3DPEHPK3PXP', 'user-1');

    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed, 'user-1')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('gives a different result every time', () => {
    expect(box.seal('same', 'user-1')).not.toBe(box.seal('same', 'user-1'));
  });

  it('refuses a value sealed for another context, so it cannot move to another user', () => {
    const sealed = box.seal('secret', 'user-1');
    expect(() => box.open(sealed, 'user-2')).toThrow();
  });

  it('refuses a changed, shortened or unknown value', () => {
    const sealed = box.seal('secret', 'user-1');
    const [format, iv, ciphertext, tag] = sealed.split('.');
    const changed = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`;

    expect(() => box.open([format, iv, changed, tag].join('.'), 'user-1')).toThrow();
    expect(() =>
      box.open([format, iv, ciphertext, tag.slice(0, 6)].join('.'), 'user-1'),
    ).toThrow();
    expect(() => box.open(['v9', iv, ciphertext, tag].join('.'), 'user-1')).toThrow();
  });

  it('refuses a value sealed with another key or for another purpose', () => {
    const sealed = box.seal('secret', 'user-1');

    expect(() =>
      new SecretBox(`${KEY_MATERIAL}x`, 'test secrets').open(sealed, 'user-1'),
    ).toThrow();
    expect(() =>
      new SecretBox(KEY_MATERIAL, 'another purpose').open(sealed, 'user-1'),
    ).toThrow();
  });
});
