import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { NotificationsService } from './notifications.service';

class ListNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class PushKeysDto {
  @IsString()
  @MaxLength(200)
  p256dh!: string;

  @IsString()
  @MaxLength(200)
  auth!: string;
}

class PushSubscribeDto {
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @MaxLength(1000)
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string;
}

class PushUnsubscribeDto {
  @IsString()
  @MaxLength(1000)
  endpoint!: string;
}

/** The caller's own console 🔔 + Web Push devices (plan §19, N56). */
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(user, query.limit);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: RequestUser) {
    return { unread: await this.notifications.unreadCount(user) };
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.notifications.markAllRead(user);
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user, id);
  }

  @Get('push/config')
  pushConfig() {
    return this.notifications.pushConfig();
  }

  @Post('push/subscribe')
  @HttpCode(200)
  subscribe(@CurrentUser() user: RequestUser, @Body() dto: PushSubscribeDto) {
    return this.notifications.subscribe(user, dto);
  }

  @Post('push/unsubscribe')
  @HttpCode(200)
  unsubscribe(@CurrentUser() user: RequestUser, @Body() dto: PushUnsubscribeDto) {
    return this.notifications.unsubscribe(user, dto.endpoint);
  }
}
