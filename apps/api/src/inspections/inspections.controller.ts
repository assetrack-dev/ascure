import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateInspectionDto } from './dto/create-inspection.dto';
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

  @Post(':inspectionId/images')
  @UseInterceptors(FileInterceptor('file'))
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
}
