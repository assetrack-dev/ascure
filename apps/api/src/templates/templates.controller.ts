import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { TemplatesService } from './templates.service';

class AssetTypeIdParamDto {
  @IsUUID()
  assetTypeId!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('asset-types')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get(':assetTypeId/active-template')
  getActiveTemplate(@CurrentUser() user: RequestUser, @Param() params: AssetTypeIdParamDto) {
    return this.templatesService.getActiveTemplate(user, params.assetTypeId);
  }
}

