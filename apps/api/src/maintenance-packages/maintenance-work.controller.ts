import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { MaintenanceWorkService } from './maintenance-work.service';

/**
 * The contractor crew's work list for the mobile maintenance mode
 * (docs/PLAN-maintenance-flow.md §7.1). Read-only: repair photos and
 * completion go through the existing /defects endpoints.
 */
@UseGuards(JwtAuthGuard)
@Controller('maintenance-work')
export class MaintenanceWorkController {
  constructor(private readonly work: MaintenanceWorkService) {}

  @Get()
  listPackages(@CurrentUser() user: RequestUser) {
    return this.work.listPackages(user);
  }

  @Get(':siteVisitId')
  getPackage(
    @CurrentUser() user: RequestUser,
    @Param('siteVisitId', ParseUUIDPipe) siteVisitId: string,
  ) {
    return this.work.getPackage(user, siteVisitId);
  }
}
