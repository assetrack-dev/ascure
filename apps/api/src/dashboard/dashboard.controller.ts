import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { DashboardService } from './dashboard.service';
import { GetDashboardQueryDto } from './dto/get-dashboard-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(
    @CurrentUser() user: RequestUser,
    @Query() query: GetDashboardQueryDto,
  ) {
    return this.dashboardService.getDashboard(user, query);
  }

  @Get('daily-team-activity')
  getDailyTeamActivity(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getDailyTeamActivity(user);
  }

  @Get('daily-user-activity')
  getDailyUserActivity(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getDailyUserActivity(user);
  }
}
