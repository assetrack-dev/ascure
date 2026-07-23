import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { IMAGE_UPLOAD_OPTIONS } from '../common/upload-options';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CorrectReadingDto } from './dto/correct-reading.dto';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { EditChecklistResultDto } from './dto/edit-checklist-result.dto';
import { RequestReinspectionDto } from './dto/request-reinspection.dto';
import { DeclareEmergencyDto } from './dto/declare-emergency.dto';
import { SaveInspectionResultsDto } from './dto/save-inspection-results.dto';
import { UploadInspectionImageDto } from './dto/upload-inspection-image.dto';
import { InspectionsService } from './inspections.service';

class InspectionIdParamDto {
  @IsUUID()
  id!: string;
}

class InspectionImageParamDto {
  @IsUUID()
  inspectionId!: string;
}

class InspectionImageDeleteParamDto {
  @IsUUID()
  inspectionId!: string;

  @IsUUID()
  imageId!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('inspections')
export class InspectionsController {
  constructor(private readonly inspectionsService: InspectionsService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateInspectionDto) {
    return this.inspectionsService.create(user, dto);
  }

  @Get(':id')
  getDetail(@CurrentUser() user: RequestUser, @Param() params: InspectionIdParamDto) {
    return this.inspectionsService.getDetail(user, params.id);
  }

  @Get(':id/form')
  getForm(@CurrentUser() user: RequestUser, @Param() params: InspectionIdParamDto) {
    return this.inspectionsService.getForm(user, params.id);
  }

  @Put(':id/results')
  saveResults(
    @CurrentUser() user: RequestUser,
    @Param() params: InspectionIdParamDto,
    @Body() dto: SaveInspectionResultsDto,
  ) {
    return this.inspectionsService.saveResults(user, params.id, dto);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: RequestUser, @Param() params: InspectionIdParamDto) {
    return this.inspectionsService.submit(user, params.id);
  }

  // In-place DC correction of the recorded BACAAN KELEGAAN 1 reading (governance
  // override of the submitted-inspection lock; ADMIN / MANAGER / QA actor only).
  @Patch(':id/kelegaan-reading')
  correctKelegaanReading(
    @CurrentUser() user: RequestUser,
    @Param() params: InspectionIdParamDto,
    @Body() dto: CorrectReadingDto,
  ) {
    return this.inspectionsService.correctKelegaanReading(user, params.id, dto);
  }

  // In-place edit of ANY recorded checklist value (generalizes kelegaan-reading)
  // — ADMIN / QA actor / the managing MANAGER (own teams + subcontractor subtree).
  @Patch(':id/checklist-result')
  editChecklistResult(
    @CurrentUser() user: RequestUser,
    @Param() params: InspectionIdParamDto,
    @Body() dto: EditChecklistResultDto,
  ) {
    return this.inspectionsService.editChecklistResult(user, params.id, dto);
  }

  // Send ONE pole back for re-inspection — keeps every captured answer/photo but
  // returns the inspection to DRAFT, so the pole reads "not inspected" again for
  // the crew (and for coverage). ADMIN / QA actor / the managing MANAGER.
  @Post(':id/request-reinspection')
  requestReinspection(
    @CurrentUser() user: RequestUser,
    @Param() params: InspectionIdParamDto,
    @Body() dto: RequestReinspectionDto,
  ) {
    return this.inspectionsService.requestReinspection(user, params.id, dto);
  }

  @Post(':id/amend')
  amend(@CurrentUser() user: RequestUser, @Param() params: InspectionIdParamDto) {
    return this.inspectionsService.amendInspection(user, params.id);
  }

  @Post(':id/declare-emergency')
  declareEmergency(
    @CurrentUser() user: RequestUser,
    @Param() params: InspectionIdParamDto,
    @Body() dto: DeclareEmergencyDto,
  ) {
    return this.inspectionsService.declareEmergency(user, params.id, dto);
  }

  @Post(':inspectionId/images')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  uploadImage(
    @CurrentUser() user: RequestUser,
    @Param() params: InspectionImageParamDto,
    @UploadedFile()
    file:
      | {
          originalname: string;
          mimetype: string;
          size: number;
          buffer: Buffer;
        }
      | undefined,
    @Body() dto: UploadInspectionImageDto,
  ) {
    return this.inspectionsService.uploadImage(user, params.inspectionId, file, dto);
  }

  @Delete(':inspectionId/images/:imageId')
  deleteImage(
    @CurrentUser() user: RequestUser,
    @Param() params: InspectionImageDeleteParamDto,
  ) {
    return this.inspectionsService.deleteImage(
      user,
      params.inspectionId,
      params.imageId,
    );
  }
}
