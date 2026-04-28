import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { UpdateDefectStatusDto } from './dto/update-defect-status.dto';
import { DefectsService } from './defects.service';

class DefectIdParamDto {
  @IsUUID()
  id!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('defects')
export class DefectsController {
  constructor(private readonly defectsService: DefectsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.defectsService.list(user);
  }

  @Get(':id')
  getDetail(@CurrentUser() user: RequestUser, @Param() params: DefectIdParamDto) {
    return this.defectsService.getDetail(user, params.id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
    @Body() dto: UpdateDefectStatusDto,
  ) {
    return this.defectsService.updateStatus(user, params.id, dto);
  }
}
