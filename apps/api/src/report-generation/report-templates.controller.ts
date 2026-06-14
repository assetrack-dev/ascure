import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { UploadReportTemplateDto } from './dto/upload-report-template.dto';
import { ReportGenerationService } from './report-generation.service';

class ReportTemplateIdParamDto {
  @IsUUID()
  id!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('report-templates')
export class ReportTemplatesController {
  constructor(
    private readonly reportGenerationService: ReportGenerationService,
  ) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.reportGenerationService.listTemplates(user);
  }

  @Delete(':id')
  delete(
    @CurrentUser() user: RequestUser,
    @Param() params: ReportTemplateIdParamDto,
  ) {
    return this.reportGenerationService.deleteTemplate(user, params.id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: RequestUser,
    @UploadedFile()
    file:
      | {
          originalname: string;
          mimetype: string;
          size: number;
          buffer: Buffer;
        }
      | undefined,
    @Body() dto: UploadReportTemplateDto,
  ) {
    return this.reportGenerationService.uploadTemplate(user, file, {
      name: dto.name ?? '',
      operationalScope: dto.operationalScope,
    });
  }
}
