import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ZodError } from 'zod';
import { ComposeValidationError } from './ai/compose.service.js';

type ResLike = {
  status?: (n: number) => { send: (b: unknown) => unknown };
  header?: (name: string, value: string) => unknown;
  send: (b: unknown) => unknown;
};

/** 把 zod 校验失败统一映射为 400 INVALID_REQUEST（对齐 api-spec 的通用错误信封）。 */
@Catch(ZodError)
export class ZodFilter implements ExceptionFilter {
  catch(ex: ZodError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse() as unknown as ResLike;
    const payload = { error: { code: 'INVALID_REQUEST', message: '参数不合法', details: ex.issues } };
    if (typeof res.status === 'function') res.status(HttpStatus.BAD_REQUEST).send(payload);
    else res.send(payload);
  }
}

/**
 * compose 输出多次校验失败 → 502（上游模型不可信），而非裸 500。
 * 对齐 dev-standard AC6「校验失败重试后降级有日志」：对用户给出可理解文案，不暴露原始输出。
 */
@Catch(ComposeValidationError)
export class ComposeErrorFilter implements ExceptionFilter {
  catch(ex: ComposeValidationError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse() as unknown as ResLike;
    const payload = {
      error: { code: 'PROMPT_OUTPUT_FAILED', message: '本次生成结果未通过校验，请稍后重试', task: ex.task },
    };
    if (typeof res.status === 'function') res.status(HttpStatus.BAD_GATEWAY).send(payload);
    else res.send(payload);
  }
}

/**
 * 统一 Nest HTTP 异常为 api-spec 的错误信封，避免默认异常响应泄露实现细节。
 * 已有 Zod/Compose 专用过滤器先匹配其更精确的错误类型。
 */
@Catch(HttpException)
export class HttpErrorFilter implements ExceptionFilter {
  catch(ex: HttpException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse() as unknown as ResLike;
    const status = ex.getStatus();
    const response = ex.getResponse();
    const responseBody = typeof response === 'string' ? { message: response } : response as Record<string, unknown>;
    const code = status === HttpStatus.BAD_REQUEST ? 'INVALID_REQUEST'
      : status === HttpStatus.UNAUTHORIZED ? 'AUTH_UNAUTHORIZED'
        : status === HttpStatus.FORBIDDEN ? 'FORBIDDEN'
          : status === HttpStatus.NOT_FOUND ? 'NOT_FOUND'
            : status === HttpStatus.CONFLICT ? 'CONFLICT_STATE'
              : status === HttpStatus.TOO_MANY_REQUESTS ? 'RATE_LIMITED'
                : status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'REQUEST_FAILED';
    const message = typeof responseBody.message === 'string' ? responseBody.message : '请求失败';
    const details = Array.isArray(responseBody.message) ? responseBody.message : undefined;
    const payload = { error: { code, message, ...(details ? { details } : {}) } };
    res.header?.('content-type', 'application/json; charset=utf-8');
    if (typeof res.status === 'function') res.status(status).send(payload);
    else res.send(payload);
  }
}
