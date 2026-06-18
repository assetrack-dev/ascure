import { Controller, Get } from '@nestjs/common';
import { PublicService } from './public.service';

/**
 * Unauthenticated, intentionally public surface for the marketing site.
 * NO JwtAuthGuard — every payload here must be a non-identifying aggregate.
 * Do not add row-level or tenant-scoped data to this controller.
 */
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('stats')
  getStats() {
    return this.publicService.getStats();
  }
}
