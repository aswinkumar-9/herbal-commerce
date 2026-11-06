import {
  Injectable,
  NestMiddleware,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { raw } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { bearerToken } from '../auth/access-token.guard';
import { AccessTokenService } from '../auth/access-token.service';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from './image-processing';
import type { ImageType } from './image-processing';

export const NOT_AN_IMAGE_UPLOAD =
  'Send one JPEG, PNG or WebP image as the request body, with its Content-Type';

// Reads an uploaded image: the request body itself, at most 10 MB, with
// one of the image types as its Content-Type. Compressed bodies are
// refused, like everywhere else (ADR 0008).
const readImage = raw({
  type: [...IMAGE_TYPES],
  limit: MAX_IMAGE_BYTES,
  inflate: false,
});

// The body parser of the image upload route, and only of that route, so no
// other route accepts a body this large (ADR 0023). A body is read before
// any guard runs, so this one is read only for a caller whose token is a
// valid staff token. Anyone else's upload is left unread, and the guard
// then answers 401. The guard still checks the rest: that the session is
// live, and the role.
@Injectable()
export class ImageUploadParser implements NestMiddleware {
  constructor(private readonly accessTokens: AccessTokenService) {}

  async use(request: Request, response: Response, next: NextFunction) {
    if (await this.hasStaffToken(request)) {
      readImage(request, response, next);
    } else {
      next();
    }
  }

  private async hasStaffToken(request: Request): Promise<boolean> {
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      return false;
    }
    try {
      await this.accessTokens.verify(token, 'staff');
      return true;
    } catch {
      return false;
    }
  }
}

// The uploaded image and its type, or 415 when the body is not one: the
// parser above reads a body only when its Content-Type is an image type.
export function uploadedImage(
  body: unknown,
  contentType: string | undefined,
): { file: Buffer; type: ImageType } {
  const type = contentType?.split(';')[0].trim().toLowerCase();
  if (!Buffer.isBuffer(body) || !isImageType(type)) {
    throw new UnsupportedMediaTypeException(NOT_AN_IMAGE_UPLOAD);
  }
  return { file: body, type };
}

function isImageType(type: string | undefined): type is ImageType {
  return (IMAGE_TYPES as readonly (string | undefined)[]).includes(type);
}
