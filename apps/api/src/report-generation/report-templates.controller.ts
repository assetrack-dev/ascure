import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { UploadReportTemplateDto } from './dto/upload-report-template.dto';
import { ReportGenerationService } from './report-generation.service';

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
