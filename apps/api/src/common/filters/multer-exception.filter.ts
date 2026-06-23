import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

/**
 * Maps multer upload errors to clean HTTP responses: an oversized file →
 * 413 Payload Too Large; anything else multer raises (too many files, unexpected
 * field, …) → 400. Without this, a size-limit abort surfaces as a 500. (A
 * rejected MIME/extension is thrown by the fileFilter as an
 * UnsupportedMediaTypeException → 415, handled by the default exception filter.)
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    const status = tooLarge
      ? HttpStatus.PAYLOAD_TOO_LARGE
      : HttpStatus.BAD_REQUEST;
    response.status(status).json({
      statusCode: status,
      error: tooLarge ? 'Payload Too Large' : 'Bad Request',
      message: tooLarge
        ? 'Uploaded file exceeds the maximum allowed size.'
        : `Upload rejected: ${error.message}.`,
    });
  }
}
