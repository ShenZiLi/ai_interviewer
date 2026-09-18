import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { ZodError } from 'zod';

type ResLike = {
  status?: (n: number) => { send: (b: unknown) => unknown };
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