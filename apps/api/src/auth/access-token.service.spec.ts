import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import type { Env } from '../config/env';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenService,
} from './access-token.service';

// Obviously fake test values.
const SECRET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const USER = {
  id: '6f1c2c4e-8a52-4f0e-9a43-3b8f2d7c1a10',
  sessionId: '0b7e5d2a-3c41-4e8f-b6a9-5d2c7e1f9a34',
};

function serviceWithSecret(secret: string): AccessTokenService {
  const config = { get: () => secret };
  return new AccessTokenService(
    new JwtService(),
    config as unknown as ConfigService<Env, true>,
  );
}

// Signs a token with our secret but any claims, as a buggy caller might.
function forge(
  payload: object,
  options: JwtSignOptions = {},
): Promise<string> {
  return new JwtService().signAsync(payload, {
    secret: SECRET,
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'herbal-api',
    audience: 'customer',
    subject: USER.id,
    ...options,
  });
}

function encodePart(part: object): string {
  return Buffer.from(JSON.stringify(part)).toString('base64url');
}

describe('AccessTokenService', () => {
  const service = serviceWithSecret(SECRET);

  afterEach(() => jest.restoreAllMocks());

  it('signs a token that verifies back to the same user and session', async () => {
    const token = await service.sign(USER);
    await expect(service.verify(token)).resolves.toEqual(USER);
  });

  it('puts only the expected claims in an HS256 token', async () => {
    const token = await service.sign(USER);
    const { header, payload } = new JwtService().decode<{
      header: { alg: string };
      payload: Record<string, string | number>;
    }>(token, { complete: true });
    expect(header.alg).toBe('HS256');
    expect(Object.keys(payload).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'sid',
      'sub',
    ]);
    expect(payload).toMatchObject({
      iss: 'herbal-api',
      aud: 'customer',
      sub: USER.id,
      sid: USER.sessionId,
    });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(
      ACCESS_TOKEN_TTL_SECONDS,
    );
  });

  it('rejects a token signed with a different secret', async () => {
    const other = serviceWithSecret(SECRET.toUpperCase());
    await expect(service.verify(await other.sign(USER))).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const signedAt = Date.parse('2026-10-24T10:00:00Z');
    const now = jest.spyOn(Date, 'now').mockReturnValue(signedAt);
    const token = await service.sign(USER);
    now.mockReturnValue(signedAt + (ACCESS_TOKEN_TTL_SECONDS + 1) * 1000);
    await expect(service.verify(token)).rejects.toThrow();
  });

  it('rejects a token older than 15 minutes, whatever expiry it claims', async () => {
    const signedAt = Date.parse('2026-10-24T10:00:00Z');
    const now = jest.spyOn(Date, 'now').mockReturnValue(signedAt);
    const token = await forge({ sid: USER.sessionId }, { expiresIn: 3600 });
    now.mockReturnValue(signedAt + (ACCESS_TOKEN_TTL_SECONDS + 60) * 1000);
    await expect(service.verify(token)).rejects.toThrow();
  });

  it('rejects other issuers, audiences and algorithms', async () => {
    const variants: JwtSignOptions[] = [
      { issuer: 'someone-else' },
      { audience: 'staff' },
      { algorithm: 'HS512' },
    ];
    for (const options of variants) {
      const token = await forge({ sid: USER.sessionId }, options);
      await expect(service.verify(token)).rejects.toThrow();
    }
  });

  it('rejects an unsigned token (alg "none")', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = [
      encodePart({ alg: 'none', typ: 'JWT' }),
      encodePart({
        sub: USER.id,
        sid: USER.sessionId,
        iss: 'herbal-api',
        aud: 'customer',
        iat: now,
        exp: now + 60,
      }),
      '',
    ].join('.');
    await expect(service.verify(token)).rejects.toThrow();
  });

  it('rejects claims we never issue', async () => {
    await expect(service.verify(await forge({}))).rejects.toThrow();
    const notAUserId = await forge(
      { sid: USER.sessionId },
      { subject: 'admin' },
    );
    await expect(service.verify(notAUserId)).rejects.toThrow();
  });
});
