// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.server.ts';

const SECRET = 'a-secret-only-these-tests-know-0123456789';

describe('the website’s settings', () => {
  it('suit a laptop with none given', () => {
    expect(loadConfig({})).toEqual({
      production: false,
      host: 'localhost',
      port: 3001,
      origin: 'http://localhost:3001',
      apiUrl: 'http://127.0.0.1:3000',
      mediaBaseUrl: 'http://127.0.0.1:3000/media',
      trustProxy: [],
      indexing: false,
      sessionSecret: expect.stringMatching(/^[\w-]{43}$/) as string,
    });
    // Made once for the server's life, so a reload signs no one out.
    expect(loadConfig({}).sessionSecret).toBe(loadConfig({}).sessionSecret);
  });

  it('take each one given, without a final "/"', () => {
    expect(
      loadConfig({
        NODE_ENV: 'production',
        WEB_HOST: '0.0.0.0',
        WEB_PORT: '8080',
        WEB_ORIGIN: 'https://shop.example.com/',
        WEB_API_URL: 'http://10.0.0.5:3000',
        WEB_MEDIA_BASE_URL: 'https://cdn.example.com/media/',
        WEB_TRUST_PROXY: 'loopback, 10.0.0.0/8',
        WEB_INDEXING: 'on',
        WEB_SESSION_SECRET: SECRET,
      }),
    ).toEqual({
      production: true,
      host: '0.0.0.0',
      port: 8080,
      origin: 'https://shop.example.com',
      apiUrl: 'http://10.0.0.5:3000',
      mediaBaseUrl: 'https://cdn.example.com/media',
      trustProxy: ['loopback', '10.0.0.0/8'],
      indexing: true,
      sessionSecret: SECRET,
    });
  });

  it('refuse an address that could change the security policy it is written into', () => {
    for (const value of [
      'http://127.0.0.1:3000/media; script-src *',
      "http://127.0.0.1:3000/media'",
      'data:text/html,x',
      'http://127.0.0.1:3000/media?x=1',
      'ftp://example.com/media',
    ]) {
      expect(() => loadConfig({ WEB_MEDIA_BASE_URL: value })).toThrow(
        'WEB_MEDIA_BASE_URL must be a plain http or https address',
      );
    }
  });

  it('refuse a port out of range, and an indexing other than on or off', () => {
    expect(() => loadConfig({ WEB_PORT: '70000' })).toThrow('WEB_PORT');
    expect(() => loadConfig({ WEB_INDEXING: 'yes' })).toThrow('WEB_INDEXING');
  });

  it('want https in production, except on this computer, where the build is checked', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        WEB_ORIGIN: 'http://shop.example.com',
        WEB_MEDIA_BASE_URL: 'http://cdn.example.com/media',
      }),
    ).toThrow(
      /WEB_ORIGIN: must use https in production\n- WEB_MEDIA_BASE_URL: must use https in production/,
    );
    expect(
      loadConfig({ NODE_ENV: 'production', WEB_SESSION_SECRET: SECRET })
        .production,
    ).toBe(true);
  });

  it('want a long session key, and one given in production, without ever saying it', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      'WEB_SESSION_SECRET: must be set in production',
    );
    let message = '';
    try {
      loadConfig({ WEB_SESSION_SECRET: 'short-and-secret' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(
      'WEB_SESSION_SECRET must have at least 32 characters',
    );
    expect(message).not.toContain('short-and-secret');
  });
});
