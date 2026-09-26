import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import {
  ReassignCannotRepairDto,
  RepairReasonDto,
  VerificationQueueQueryDto,
  VerifyRepairDto,
} from './dto/maintenance-closure.dto';
import { MaintenanceClosureService } from './maintenance-closure.service';

/**
 * Sign-off of repairs on routed Kejanggalan (docs/PLAN-maintenance-flow.md
 * §5.3): TNB, the main contractor manager, and ADMIN. The service enforces who
 * may do what and over which Kejanggalan.
 */
@UseGuards(JwtAuthGuard)
@Controller('maintenance-verification')
export class MaintenanceVerificationController {
  constructor(private readonly closure: MaintenanceClosureService) {}

  @Get()
  getQueue(@CurrentUser() user: RequestUser, @Query() query: VerificationQueueQueryDto) {
    return this.closure.getQueue(user, query.tab);
  }

  @Post(':defectId/verify')
  verify(
    @CurrentUser() user: RequestUser,
    @Param('defectId', ParseUUIDPipe) defectId: string,
    @Body() dto: VerifyRepairDto,
  ) {
    return this.closure.verify(user, defectId, dto);
  }

  @Post(':defectId/reject')
  reject(
    @CurrentUser() user: RequestUser,
    @Param('defectId', ParseUUIDPipe) defectId: string,
    @Body() dto: RepairReasonDto,
  ) {
    return this.closure.reject(user, defectId, dto);
  }

  @Post(':defectId/reopen')
  reopen(
    @CurrentUser() user: RequestUser,
    @Param('defectId', ParseUUIDPipe) defectId: string,
    @Body() dto: RepairReasonDto,
  ) {
    return this.closure.reopen(user, defectId, dto);
  }

  @Post(':defectId/reassign')
  reassign(
    @CurrentUser() user: RequestUser,
    @Param('defectId', ParseUUIDPipe) defectId: string,
    @Body() dto: ReassignCannotRepairDto,
  ) {
    return this.closure.reassignCannotRepair(user, defectId, dto);
  }
}
