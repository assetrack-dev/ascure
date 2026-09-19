import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import { AppModule } from './app.module';
import { configureApp } from './app.config';

// RSS-leak mitigation 2 (MemWatch diagnosis: heap is GC-clean but the RSS
// floor ratchets with export load — glibc arena fragmentation from libvips
// churn; MALLOC_ARENA_MAX=2 alone did not hold the floor).
// - cache(false): libvips' operation cache holds buffers across requests,
//   pinning fragmented pages long after a report finishes.
// - concurrency(1): report photos are processed sequentially anyway; a single
//   libvips worker thread means fewer malloc arenas and a lower peak-churn
//   surface. Process-wide — sharp is a singleton in the hoisted node_modules.
sharp.cache(false);
sharp.concurrency(1);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = Number(process.env.PORT ?? 3000);

  configureApp(app);

  await app.listen(port, '0.0.0.0');
}

bootstrap();
