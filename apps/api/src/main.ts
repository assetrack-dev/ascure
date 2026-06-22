import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { UPLOADS_DIRECTORY } from './common/uploads.constants';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = Number(process.env.PORT ?? 3000);

  // Behind nginx (one hop): trust X-Forwarded-For so req.ip is the real client
  // IP, not the proxy. Lets the login rate-limiter throttle per client instead
  // of lumping every request under the proxy's address. (nginx must forward
  // X-Forwarded-For — the standard reverse-proxy header.)
  app.set('trust proxy', 1);

  app.setGlobalPrefix('api/v1');
  app.useStaticAssets(UPLOADS_DIRECTORY, {
    prefix: '/uploads/',
  });

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  await app.listen(port, '0.0.0.0');
}

bootstrap();
