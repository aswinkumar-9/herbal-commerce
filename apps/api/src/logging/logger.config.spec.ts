import { buildLoggerParams, withoutSearchWords } from './logger.config';

describe('withoutSearchWords', () => {
  it('hides what a customer searched for, and keeps the rest of the address', () => {
    expect(withoutSearchWords('/v1/products?q=piles%20relief&page=2')).toBe(
      '/v1/products?q=[REDACTED]&page=2',
    );
    expect(withoutSearchWords('/v1/products?sort=name&q=sugar')).toBe(
      '/v1/products?sort=name&q=[REDACTED]',
    );
    expect(withoutSearchWords('/v1/products?q=')).toBe(
      '/v1/products?q=[REDACTED]',
    );
    expect(withoutSearchWords('/v1/products?q=a&q=b')).toBe(
      '/v1/products?q=[REDACTED]&q=[REDACTED]',
    );
  });

  it('leaves other addresses as they are, a parameter merely ending in q too', () => {
    for (const url of [
      '/v1/products?faq=1',
      '/v1/categories/herbal-teas/products?limit=20',
      '/v1/products/ashwagandha-capsules',
    ]) {
      expect(withoutSearchWords(url)).toBe(url);
    }
  });
});

describe('buildLoggerParams', () => {
  const pinoHttp = buildLoggerParams({ NODE_ENV: 'test', LOG_LEVEL: 'silent' })
    .pinoHttp as {
    redact: { paths: string[] };
    serializers: { req: (req: { url?: string }) => { url?: string } };
  };

  it('logs a request without its search words, in the address or the parsed query', () => {
    expect(pinoHttp.redact.paths).toContain('req.query.q');
    expect(
      pinoHttp.serializers.req({ url: '/v1/products?q=diabetes' }),
    ).toEqual({ url: '/v1/products?q=[REDACTED]' });
    expect(pinoHttp.serializers.req({})).toEqual({});
  });
});
