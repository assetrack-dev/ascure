import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { ClientSupervisorsService } from './client-supervisors.service';

class SetSupervisorCompaniesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  organizationIds!: string[];
}

/**
 * TNB Supervisors and the contractor companies each one handles
 * (docs/PLAN-maintenance-flow.md §19, N55). ADMIN sees every TNB Supervisor;
 * a TNB Foreman / Technician only those of its own TNB organization.
 */
@UseGuards(JwtAuthGuard)
@Controller('client-supervisors')
export class ClientSupervisorsController {
  constructor(private readonly supervisors: ClientSupervisorsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.supervisors.list(user);
  }

  @Put(':userId/companies')
  setCompanies(
    @CurrentUser() user: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetSupervisorCompaniesDto,
  ) {
    return this.supervisors.setCompanies(user, userId, dto.organizationIds);
  }
}
