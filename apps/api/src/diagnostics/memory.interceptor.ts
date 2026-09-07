import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { DiagnosticsService } from './diagnostics.service';

/**
 * Global memory-attribution tap for the RSS-leak hunt: tags every request with
 * its Controller.handler and hands the before/after memory bookkeeping to
 * DiagnosticsService. Pure observation — never alters the response, and a
 * streamed body (StreamableFile/archiver) finalizes when the handler's
 * observable settles, which is close enough for aggregate attribution.
 */
@Injectable()
export class MemoryUsageInterceptor implements NestInterceptor {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const routeKey = `${context.getClass().name}.${context.getHandler().name}`;
    const end = this.diagnostics.beginRequest(routeKey);
    return next.handle().pipe(finalize(end));
  }
}
