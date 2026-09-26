import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import {
  AssignEmergencyDto,
  AssignMaintenancePackageDto,
} from './dto/assign-maintenance-package.dto';
import { MaintenancePackagesService } from './maintenance-packages.service';

/**
 * TNB → maintenance company hand-off of surveyed Pencawang
 * (docs/PLAN-maintenance-flow.md §5). ADMIN + TNB only; the service enforces
 * rank (FOREMAN / TECHNICIAN assign, ENGINEER views) and Mainhead scope.
 */
@UseGuards(JwtAuthGuard)
@Controller('maintenance-packages')
export class MaintenancePackagesController {
  constructor(private readonly packages: MaintenancePackagesService) {}

  @Get('board')
  getBoard(@CurrentUser() user: RequestUser) {
    return this.packages.getBoard(user);
  }

  @Post()
  assign(@CurrentUser() user: RequestUser, @Body() dto: AssignMaintenancePackageDto) {
    return this.packages.assign(user, dto);
  }

  @Delete(':id')
  unassign(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.packages.unassign(user, id);
  }

  @Post('emergencies/:defectId')
  assignEmergency(
    @CurrentUser() user: RequestUser,
    @Param('defectId', ParseUUIDPipe) defectId: string,
    @Body() dto: AssignEmergencyDto,
  ) {
    return this.packages.assignEmergency(user, defectId, dto);
  }
}
