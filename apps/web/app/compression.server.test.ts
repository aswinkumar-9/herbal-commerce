// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chooseEncoding, varyByEncoding } from './compression.server.ts';

describe('choosing how to compress an answer', () => {
  it('takes Brotli whenever the browser does, as every current browser does', () => {
    expect(chooseEncoding('gzip, deflate, br, zstd')).toBe('br');
    expect(chooseEncoding('br')).toBe('br');
    expect(chooseEncoding('BR;q=1.0, gzip;q=1.0')).toBe('br');
  });

  it('takes gzip when Brotli is not wanted, or wanted less', () => {
    expect(chooseEncoding('gzip, deflate')).toBe('gzip');
    expect(chooseEncoding('br;q=0, gzip')).toBe('gzip');
    expect(chooseEncoding('br;q=0.2, gzip;q=0.8')).toBe('gzip');
  });

  it('sends the plain bytes when neither is taken', () => {
    expect(chooseEncoding(null)).toBeNull();
    expect(chooseEncoding('')).toBeNull();
    expect(chooseEncoding('identity')).toBeNull();
    expect(chooseEncoding('br;q=0, gzip;q=0')).toBeNull();
    expect(chooseEncoding('deflate;q=nonsense')).toBeNull();
  });

  it('reads a wildcard as any coding not named', () => {
    expect(chooseEncoding('*')).toBe('br');
    expect(chooseEncoding('br;q=0, *')).toBe('gzip');
  });
});

describe('saying the answer varies by its coding', () => {
  it('adds Accept-Encoding once, beside what is there', () => {
    const headers = new Headers({ Vary: 'Cookie' });
    varyByEncoding(headers);
    varyByEncoding(headers);
    expect(headers.get('vary')).toBe('Cookie, Accept-Encoding');
  });
});
