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

  @Get()
  @Roles(UserRole.ADMIN)
  list(@CurrentUser() user: RequestUser) {
    return this.usersService.list(user);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateUserDto) {
    return this.usersService.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @CurrentUser() user: RequestUser,
    @Param() params: UserIdParamDto,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(user, params.id, dto);
  }

  @Patch(':id/password')
  @Roles(UserRole.ADMIN)
  updatePassword(
    @CurrentUser() user: RequestUser,
    @Param() params: UserIdParamDto,
    @Body() dto: UpdateUserPasswordDto,
  ) {
    return this.usersService.updatePassword(user, params.id, dto);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param() params: UserIdParamDto,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.updateStatus(user, params.id, dto);
  }
}
