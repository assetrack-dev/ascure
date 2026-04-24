import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { AssetTypeIdParamDto } from './dto/template-params.dto';
import { TemplatesService } from './templates.service';

@UseGuards(JwtAuthGuard)
@Controller('asset-types')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get(':assetTypeId/active-template')
  getActiveTemplate(@CurrentUser() user: RequestUser, @Param() params: AssetTypeIdParamDto) {
    return this.templatesService.getActiveTemplate(user, params.assetTypeId);
  }
}
