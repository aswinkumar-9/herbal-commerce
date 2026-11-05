import { UnsupportedMediaTypeException } from '@nestjs/common';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AccessTokenService } from '../auth/access-token.service';
import {
  ImageUploadParser,
  NOT_AN_IMAGE_UPLOAD,
  uploadedImage,
} from './image-upload';

const TEN_MB = 10 * 1024 * 1024;

// A small app with only the parser. It answers with what the parser read.
function setup() {
  const accessTokens = {
    verify: jest.fn((token: string, audience: string) =>
      token === 'staff-token' && audience === 'staff'
        ? Promise.resolve({ id: 'staff-1', sessionId: 'session-1' })
        : Promise.reject(new Error('Invalid token')),
    ),
  };
  const parser = new ImageUploadParser(
    accessTokens as unknown as AccessTokenService,
  );
  const app = express();
  app.post(
    '/upload',
    (req: Request, res: Response, next: NextFunction) => {
      void parser.use(req, res, next);
    },
    (req: Request, res: Response) => {
      const body: unknown = req.body;
      res.json({
        read: Buffer.isBuffer(body),
        bytes: Buffer.isBuffer(body) ? body.length : null,
      });
    },
  );
  app.use(
    (
      error: { status?: number; type?: string },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      res.status(error.status ?? 500).json({ error: error.type });
    },
  );
  return { app, accessTokens };
}

function upload(
  app: express.Express,
  authorization: string | null,
  contentType: string,
  body: Buffer | string,
) {
  const call = request(app).post('/upload').set('Content-Type', contentType);
  return (authorization ? call.set('Authorization', authorization) : call).send(
    body,
  );
}

describe('ImageUploadParser', () => {
  it('reads the image of a caller with a valid staff token', async () => {
    const { app, accessTokens } = setup();

    const response = await upload(
      app,
      'Bearer staff-token',
      'image/jpeg',
      Buffer.alloc(1000, 1),
    );

    expect(response.body).toEqual({ read: true, bytes: 1000 });
    expect(accessTokens.verify).toHaveBeenCalledWith('staff-token', 'staff');
  });

  it('leaves the body unread without a token, or with any other token', async () => {
    const { app } = setup();

    for (const authorization of [
      null,
      'Bearer customer-token',
      'Bearer forged',
      'Basic staff-token',
      'Bearer staff-token extra',
    ]) {
      const response = await upload(
        app,
        authorization,
        'image/jpeg',
        Buffer.alloc(1000, 1),
      );
      expect([authorization, response.body]).toEqual([
        authorization,
        { read: false, bytes: null },
      ]);
    }
  });

  it('reads only the three image types', async () => {
    const { app } = setup();

    for (const type of ['image/png', 'image/webp', 'IMAGE/JPEG; q=1']) {
      const response = await upload(app, 'Bearer staff-token', type, Buffer.alloc(10, 1));
      expect([type, response.body]).toEqual([type, { read: true, bytes: 10 }]);
    }
    for (const type of ['image/gif', 'image/svg+xml', 'application/json', 'text/plain']) {
      const response = await upload(app, 'Bearer staff-token', type, 'x');
      expect([type, response.body]).toEqual([type, { read: false, bytes: null }]);
    }
  });

  it('takes at most 10 MB, and refuses a compressed body', async () => {
    const { app } = setup();

    const exactly = await upload(
      app,
      'Bearer staff-token',
      'image/jpeg',
      Buffer.alloc(TEN_MB, 1),
    );
    expect(exactly.body).toEqual({ read: true, bytes: TEN_MB });

    const tooLarge = await upload(
      app,
      'Bearer staff-token',
      'image/jpeg',
      Buffer.alloc(TEN_MB + 1, 1),
    );
    expect([tooLarge.status, tooLarge.body]).toEqual([
      413,
      { error: 'entity.too.large' },
    ]);

    const compressed = await request(app)
      .post('/upload')
      .set('Authorization', 'Bearer staff-token')
      .set('Content-Type', 'image/jpeg')
      .set('Content-Encoding', 'gzip')
      .send(Buffer.alloc(10, 1));
    expect([compressed.status, compressed.body]).toEqual([
      415,
      { error: 'encoding.unsupported' },
    ]);
  });
});

describe('uploadedImage', () => {
  it('gives the file and its type, from any spelling of the Content-Type', () => {
    const file = Buffer.from('image bytes');

    expect(uploadedImage(file, 'image/jpeg')).toEqual({ file, type: 'image/jpeg' });
    expect(uploadedImage(file, 'IMAGE/PNG; charset=binary')).toEqual({
      file,
      type: 'image/png',
    });
    expect(uploadedImage(file, ' image/webp ')).toEqual({
      file,
      type: 'image/webp',
    });
  });

  it('answers 415 when the body is not an image of one of the three types', () => {
    const file = Buffer.from('image bytes');
    const wrong: [unknown, string | undefined][] = [
      [{ name: 'photo.jpg' }, 'application/json'],
      [undefined, 'image/jpeg'],
      ['image bytes', 'image/jpeg'],
      [file, 'image/gif'],
      [file, 'application/octet-stream'],
      [file, undefined],
    ];
    for (const [body, contentType] of wrong) {
      expect(() => uploadedImage(body, contentType)).toThrow(
        new UnsupportedMediaTypeException(NOT_AN_IMAGE_UPLOAD),
      );
    }
  });
});
