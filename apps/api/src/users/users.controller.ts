import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPasswordDto } from './dto/update-user-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserIdParamDto } from './dto/user-id-param.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me/teams')
  getCurrentUserTeams(@CurrentUser() user: RequestUser) {
    return this.usersService.getCurrentUserTeams(user);
  }

  @Get('me/mainheads')
  getCurrentUserMainheads(@CurrentUser() user: RequestUser) {
    return this.usersService.getCurrentUserMainheads(user);
  }

  @Get('me/capabilities')
  getCurrentUserCapabilities(@CurrentUser() user: RequestUser) {
    return this.usersService.getCurrentUserCapabilities(user);
  }

  @Get(':id/capabilities')
  @Roles(UserRole.ADMIN)
  getUserCapabilities(
    @CurrentUser() user: RequestUser,
    @Param() params: UserIdParamDto,
  ) {
    return this.usersService.getCapabilitiesForUser(user, params.id);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  list(@CurrentUser() user: RequestUser) {
    return this.usersService.list(user);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateUserDto) {
    return this.usersService.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  update(
    @CurrentUser() user: RequestUser,
    @Param() params: UserIdParamDto,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(user, params.id, dto);
  }

  @Patch(':id/password')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  updatePassword(
    @CurrentUser() user: RequestUser,
    @Param() params: UserIdParamDto,
    @Body() dto: UpdateUserPasswordDto,
  ) {
    return this.usersService.updatePassword(user, params.id, dto);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param() params: UserIdParamDto,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.updateStatus(user, params.id, dto);
  }
}
