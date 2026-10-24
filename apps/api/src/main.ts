import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { Env } from './config/env';

async function bootstrap() {
  // Nest's default parsers also accept HTML-form bodies; this API takes JSON only.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  // Security headers, and no X-Powered-By.
  app.use(helmet());
  // At most 100 kB, and compressed bodies are refused.
  app.useBodyParser('json', { limit: '100kb', inflate: false });
  app.setGlobalPrefix('v1', { exclude: ['health', 'health/ready'] });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.enableShutdownHooks();
  // Listen on localhost only while developing.
  await app.listen(config.get('API_PORT', { infer: true }), '127.0.0.1');
}

void bootstrap();

