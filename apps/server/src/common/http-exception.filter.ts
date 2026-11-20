import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let msg: string;
      let data: Record<string, unknown> | null = null;

      if (typeof body === 'string') {
        msg = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        msg = String(b.error ?? b.message ?? exception.message);
        const extra = Object.fromEntries(
          Object.entries(b).filter(([k]) => !['error', 'message', 'statusCode'].includes(k))
        );
        if (Object.keys(extra).length) data = extra;
      } else {
        msg = exception.message;
      }

      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        // @nestjs/throttler 对具名限速只写 Retry-After-<name>（如 Retry-After-login）。
        // 统一补一个标准 Retry-After 头，并放进 data.retryAfter，前端才能告诉用户要等多久。
        const retryAfter = retryAfterSeconds(res);
        if (retryAfter > 0) {
          res.setHeader('Retry-After', String(retryAfter));
          data = { ...(data ?? {}), retryAfter };
        }
      }

      return res.status(status).json({ code: status, msg, data });
    }

    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 500,
      msg: 'internal server error',
      data: null,
    });
  }
}

/** 取限速剩余秒数：标准 Retry-After 优先，其次各具名限速器的 Retry-After-<name>，取最大值 */
export function retryAfterSeconds(res: Pick<Response, 'getHeaderNames' | 'getHeader'>): number {
  let max = 0;
  for (const name of res.getHeaderNames()) {
    const lower = name.toLowerCase();
    if (lower !== 'retry-after' && !lower.startsWith('retry-after-')) continue;
    const value = Number(res.getHeader(name));
    if (Number.isFinite(value) && value > max) max = Math.ceil(value);
  }
  return max;
}
