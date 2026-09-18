import { Inject, Injectable } from '@nestjs/common';
import { taskSchema, type TaskCode } from '@ai-interviewer/contracts';
import type { Provider } from './provider.interface.js';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** compose 输出校验失败（含重试后仍失败）。 */
export class ComposeValidationError extends Error {
  constructor(
    public readonly task: TaskCode,
    cause: unknown,
  ) {
    super(`任务 ${task} 输出未通过契约校验`);
    this.name = 'ComposeValidationError';
    this.cause = cause;
  }
}

/**
 * 编排层：调用 Provider 生成 → 依 taskSchema 校验 → 重试一次 → 仍失败抛 ComposeValidationError。
 * 对齐 docs/output-schemas.md「校验失败重试一次，仍失败降级」。
 */
@Injectable()
export class ComposeService {
  constructor(@Inject(LLM_PROVIDER) private readonly provider: Provider) {}

  async compose(task: TaskCode, context: unknown): Promise<Record<string, unknown> | unknown[]> {
    const schema = taskSchema(task);
    let raw: unknown;
    try {
      raw = await this.provider.completeTask({ task, context });
    } catch (err) {
      throw new ComposeValidationError(task, err);
    }
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    // 幂等重试一次
    raw = await this.provider.completeTask({ task, context });
    const retried = schema.safeParse(raw);
    if (retried.success) return retried.data;
    throw new ComposeValidationError(task, parsed.error);
  }
}