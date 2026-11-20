// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.server.ts';

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
    });
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
    expect(loadConfig({ NODE_ENV: 'production' }).production).toBe(true);
  });
});
