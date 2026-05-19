import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CompleteDefectMaintenanceDto } from './dto/complete-defect-maintenance.dto';
import { CreateDefectCommentDto } from './dto/create-defect-comment.dto';
import { UpdateDefectAssignmentDto } from './dto/update-defect-assignment.dto';
import { UpdateDefectDueDateDto } from './dto/update-defect-due-date.dto';
import { UpdateDefectStatusDto } from './dto/update-defect-status.dto';
import { UpdateDefectVerificationDto } from './dto/update-defect-verification.dto';
import { VerifyDefectClosureDto } from './dto/verify-defect-closure.dto';
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

  @Patch(':id/assignment')
  updateAssignment(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
    @Body() dto: UpdateDefectAssignmentDto,
  ) {
    return this.defectsService.updateAssignment(user, params.id, dto);
  }

  @Patch(':id/due-date')
  updateDueDate(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
    @Body() dto: UpdateDefectDueDateDto,
  ) {
    return this.defectsService.updateDueDate(user, params.id, dto);
  }

  @Patch(':id/verify')
  verifyDefect(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
    @Body() dto: UpdateDefectVerificationDto,
  ) {
    return this.defectsService.verifyDefect(user, params.id, dto);
  }

  @Patch(':id/reject')
  rejectDefect(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
    @Body() dto: UpdateDefectVerificationDto,
  ) {
    return this.defectsService.rejectDefect(user, params.id, dto);
  }

  @Patch(':id/maintenance-completion')
  completeMaintenance(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
    @Body() dto: CompleteDefectMaintenanceDto,
  ) {
    return this.defectsService.completeMaintenance(user, params.id, dto);
  }

  @Patch(':id/closure-verification')
  verifyClosure(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
    @Body() dto: VerifyDefectClosureDto,
  ) {
    return this.defectsService.verifyClosure(user, params.id, dto);
  }

  @Post(':id/comments')
  addComment(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
    @Body() dto: CreateDefectCommentDto,
  ) {
    return this.defectsService.addComment(user, params.id, dto);
  }
}
