import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { getCorsOrigins } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind a reverse proxy (production) the real client IP is needed for rate limiting.
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: getCorsOrigins(), credentials: true });
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
