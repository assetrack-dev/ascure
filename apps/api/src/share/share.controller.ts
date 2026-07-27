import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsUUID, Length, Matches } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { ShareService } from './share.service';

class AssetIdParamDto {
  @IsUUID()
  id!: string;
}

class ShareTokenParamDto {
  @Length(16, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  token!: string;
}

@Controller('share')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  /** Mint a share link for one pole. Internal: ADMIN / MANAGER / QA actor. */
  @UseGuards(JwtAuthGuard)
  @Post('asset/:id')
  create(
    @CurrentUser() user: RequestUser,
    @Param() params: AssetIdParamDto,
    @Body() dto: CreateShareLinkDto,
  ) {
    return this.shareService.createLink(user, params.id, dto.expiresInDays ?? 30);
  }

  /**
   * PUBLIC (no JwtAuthGuard on purpose): the unguessable token in the path is
   * the credential, and it resolves to a read-only view of exactly one asset.
   * Throttled so token guessing is not a practical attack.
   */
  @UseGuards(ThrottlerGuard)
  @Get('pole/:token')
  resolve(@Param() params: ShareTokenParamDto) {
    return this.shareService.resolve(params.token);
  }
}
