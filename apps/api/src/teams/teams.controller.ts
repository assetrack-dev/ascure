import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateTeamDto, UpdateTeamDto, UpdateTeamStatusDto } from './dto/manage-team.dto';
import { TeamIdParamDto } from './dto/team-id-param.dto';
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
  @Roles(UserRole.ADMIN)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTeamDto) {
    return this.teamsService.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @CurrentUser() user: RequestUser,
    @Param() params: TeamIdParamDto,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teamsService.update(user, params.id, dto);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param() params: TeamIdParamDto,
    @Body() dto: UpdateTeamStatusDto,
  ) {
    return this.teamsService.updateStatus(user, params.id, dto);
  }
}
