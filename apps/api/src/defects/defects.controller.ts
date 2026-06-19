import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CompleteDefectMaintenanceDto } from './dto/complete-defect-maintenance.dto';
import { CreateDefectCommentDto } from './dto/create-defect-comment.dto';
import { DelegateDefectDto } from './dto/delegate-defect.dto';
import { ListDefectOperationsBoardQueryDto } from './dto/list-defect-operations-board-query.dto';
import { UpdateDefectAssignmentDto } from './dto/update-defect-assignment.dto';
import { UpdateDefectDueDateDto } from './dto/update-defect-due-date.dto';
import { UpdateDefectStatusDto } from './dto/update-defect-status.dto';
import { UpdateDefectVerificationDto } from './dto/update-defect-verification.dto';
import { UploadDefectEvidenceImageDto } from './dto/upload-defect-evidence-image.dto';
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

  @Get('operations-board')
  getOperationsBoard(
    @CurrentUser() user: RequestUser,
    @Query() query: ListDefectOperationsBoardQueryDto,
  ) {
    return this.defectsService.getOperationsBoard(user, query);
  }

  @Get('active-emergencies')
  listActiveEmergencies(@CurrentUser() user: RequestUser) {
    return this.defectsService.listActiveEmergencies(user);
  }

  @Get(':id')
  getDetail(@CurrentUser() user: RequestUser, @Param() params: DefectIdParamDto) {
    return this.defectsService.getDetail(user, params.id);
  }

  @Post(':id/evidence-images')
  @UseInterceptors(FileInterceptor('file'))
  uploadEvidenceImage(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
    @Body() dto: UploadDefectEvidenceImageDto,
    @UploadedFile()
    file:
      | {
          originalname: string;
          mimetype: string;
          size: number;
          buffer: Buffer;
        }
      | undefined,
  ) {
    return this.defectsService.uploadEvidenceImage(user, params.id, dto, file);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
    @Body() dto: UpdateDefectStatusDto,
  ) {
    return this.defectsService.updateStatus(user, params.id, dto);
  }

  @Get(':id/assignment-options')
  getAssignmentOptions(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
  ) {
    return this.defectsService.getAssignmentOptions(user, params.id);
  }

  @Patch(':id/assignment')
  updateAssignment(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
    @Body() dto: UpdateDefectAssignmentDto,
  ) {
    return this.defectsService.updateAssignment(user, params.id, dto);
  }

  @Patch(':id/delegate')
  delegateDefect(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
    @Body() dto: DelegateDefectDto,
  ) {
    return this.defectsService.delegateDefect(user, params.id, dto);
  }

  @Patch(':id/claim')
  claimDefect(
    @CurrentUser() user: RequestUser,
    @Param() params: DefectIdParamDto,
  ) {
    return this.defectsService.claimDefect(user, params.id);
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
