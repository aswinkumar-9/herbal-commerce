import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'express';

// Serves the uploaded files at /media (ADR 0023): only files, never a
// folder listing or a hidden file; anything else answers 404. A file never
// changes, as a changed image gets a new name, so browsers may keep it for
// a year. Other sites, such as the shop's website, may show it.
export function serveMedia(
  app: NestExpressApplication,
  directory: string,
): void {
  app.useStaticAssets(directory, {
    prefix: '/media/',
    index: false,
    dotfiles: 'deny',
    redirect: false,
    immutable: true,
    maxAge: '365d',
    setHeaders: (response: Response) => {
      // helmet lets only the API's own pages show what it sends.
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });
}
