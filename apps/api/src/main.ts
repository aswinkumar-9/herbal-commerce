import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { Env } from './config/env';
import { MediaStorage } from './media/media-storage';
import { serveMedia } from './media/serve-media';

async function bootstrap() {
  // Nest's default parsers also accept HTML-form bodies; this API takes JSON only.
  // Razorpay signs its webhooks over the body exactly as it arrived, so the
  // JSON parser keeps those bytes too, as request.rawBody (ADR 0027).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // Only the listed proxies may report the client IP (X-Forwarded-For). With
  // none listed, req.ip is the address that connected, which cannot be faked.
  const trustedProxies = config.get('TRUST_PROXY', { infer: true });
  app.set('trust proxy', trustedProxies.length > 0 ? trustedProxies : false);
  // Security headers, and no X-Powered-By.
  app.use(helmet());
  // Uploaded images, at /media (ADR 0023).
  serveMedia(app, app.get(MediaStorage).directory);
  // At most 100 kB, and compressed bodies are refused.
  app.useBodyParser('json', { limit: '100kb', inflate: false });
  app.setGlobalPrefix('v1', { exclude: ['health', 'health/ready'] });
  app.enableShutdownHooks();
  // Listen on localhost only while developing.
  await app.listen(config.get('API_PORT', { infer: true }), '127.0.0.1');
}

void bootstrap();
