import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateTeamDto, UpdateTeamDto, UpdateTeamStatusDto } from './dto/manage-team.dto';
import { TeamIdParamDto } from './dto/team-id-param.dto';
import { SetTeamSupervisorsDto } from './dto/team-supervisors.dto';
import { TeamsService } from './teams.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.teamsService.list(user);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTeamDto) {
    return this.teamsService.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  update(
    @CurrentUser() user: RequestUser,
    @Param() params: TeamIdParamDto,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teamsService.update(user, params.id, dto);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param() params: TeamIdParamDto,
    @Body() dto: UpdateTeamStatusDto,
  ) {
    return this.teamsService.updateStatus(user, params.id, dto);
  }

  @Get(':id/supervisors')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  listSupervisors(
    @CurrentUser() user: RequestUser,
    @Param() params: TeamIdParamDto,
  ) {
    return this.teamsService.listSupervisors(user, params.id);
  }

  @Put(':id/supervisors')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  setSupervisors(
    @CurrentUser() user: RequestUser,
    @Param() params: TeamIdParamDto,
    @Body() dto: SetTeamSupervisorsDto,
  ) {
    return this.teamsService.setSupervisors(user, params.id, dto);
  }
}
