import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = Number(process.env.PORT ?? 3000);

  configureApp(app);

  await app.listen(port, '0.0.0.0');
}

bootstrap();
