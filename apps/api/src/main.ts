import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.enableShutdownHooks();
  // Listen on localhost only while developing.
  await app.listen(config.get('API_PORT', { infer: true }), '127.0.0.1');
}

void bootstrap();
