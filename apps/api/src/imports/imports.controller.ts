import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SPREADSHEET_UPLOAD_OPTIONS } from '../common/upload-options';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { CommitSavrKlbDto } from './dto/commit-savr-klb.dto';
import { ImportsService } from './imports.service';

type UploadedExcel = { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined;

const MAX_BYTES = 10 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller('imports/savr-klb')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('validate')
  @UseInterceptors(FileInterceptor('file', SPREADSHEET_UPLOAD_OPTIONS))
  validate(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: UploadedExcel,
    @Body('batchId') batchId?: string,
  ) {
    this.assertFile(file);
    return this.importsService.validate(user, file!.buffer, this.normalizeBatchId(batchId, file!.originalname));
  }

  @Post('commit')
  @UseInterceptors(FileInterceptor('file', SPREADSHEET_UPLOAD_OPTIONS))
  commit(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: UploadedExcel,
    @Body() dto: CommitSavrKlbDto,
  ) {
    this.assertFile(file);
    if (!dto?.batchId) {
      throw new BadRequestException('batchId is required for commit.');
    }
    return this.importsService.commit(user, file!.buffer, dto.batchId);
  }

  private assertFile(file: UploadedExcel): void {
    if (!file?.buffer?.length) {
      throw new BadRequestException('An .xlsx file is required (multipart field "file").');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException(`File exceeds the ${MAX_BYTES / (1024 * 1024)}MB limit.`);
    }
  }

  private normalizeBatchId(batchId: string | undefined, filename: string): string {
    const cleaned = (batchId ?? '').trim();
    if (cleaned) return cleaned;
    return (filename || 'import').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 120) || 'import';
  }
}
