import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const FORMAT = 'v1';
// AES-GCM's standard nonce size, and its full-length authentication tag.
const IV_BYTES = 12;
const TAG_BYTES = 16;

const base64url = (data: Buffer) => data.toString('base64url');

// Encrypts small secrets for storing in the database (AES-256-GCM).
// - The key is derived from the key material for one purpose only (HKDF).
// - The context, for example a user ID, is bound to the result: a sealed
//   value copied to another row will not open there.
// - Any change to a sealed value is detected, and it then refuses to open.
export class SecretBox {
  private readonly key: Buffer;

  constructor(keyMaterial: string, purpose: string) {
    this.key = Buffer.from(hkdfSync('sha256', keyMaterial, '', purpose, 32));
  }

  // Returns "v1.<iv>.<ciphertext>.<tag>", each part in base64url. The version
  // prefix lets a later key or format be told apart from this one.
  seal(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [FORMAT, base64url(iv), base64url(ciphertext), base64url(cipher.getAuthTag())].join('.');
  }

  // Throws if the value was changed, or sealed for another context, with
  // another key or for another purpose.
  open(sealed: string, context: string): string {
    const [format, iv, ciphertext, tag, ...rest] = sealed.split('.');
    if (format !== FORMAT || tag === undefined || rest.length > 0) {
      throw new Error('Not a sealed value in a known format');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64url'),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
