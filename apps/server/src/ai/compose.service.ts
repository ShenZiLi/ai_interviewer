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
    return this.run(task, context);
  }

  /** 与 compose 同样校验/重试，但会透传模型增量文本与解析阶段，供 SSE 调用方观察。 */
  async composeWithProgress(
    task: TaskCode,
    context: unknown,
    onProgress: (event: { phase: 'requesting' | 'delta' | 'validating' | 'retrying' | 'complete'; message: string }) => void,
  ): Promise<Record<string, unknown> | unknown[]> {
    return this.run(task, context, onProgress);
  }

  private async run(
    task: TaskCode,
    context: unknown,
    onProgress?: (event: { phase: 'requesting' | 'delta' | 'validating' | 'retrying' | 'complete'; message: string }) => void,
  ): Promise<Record<string, unknown> | unknown[]> {
    const schema = taskSchema(task);
    const taskLabel: Partial<Record<TaskCode, string>> = {
      P01: '简历', P02: '岗位匹配', P03: '考察方向', P04: '面试大纲',
    };
    const label = taskLabel[task] ?? task;
    let firstError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      onProgress?.({ phase: 'requesting', message: attempt === 1 ? `正在请求模型处理${label}…` : `正在按结构要求重新生成${label}…` });
      let raw: unknown;
      try {
        const attemptContext = attempt === 2 && context && typeof context === 'object' && !Array.isArray(context)
          ? { ...context as Record<string, unknown>, repairInstruction: '上一次 JSON 未通过字段校验。请严格逐项检查必填字段、枚举值、数组长度和数字类型后重新输出完整 JSON。' }
          : context;
        raw = this.provider.streamTask
          ? await this.provider.streamTask({ task, context: attemptContext, onDelta: (text) => onProgress?.({ phase: 'delta', message: text }) })
          : await this.provider.completeTask({ task, context: attemptContext });
      } catch (err) {
        throw new ComposeValidationError(task, err);
      }
      onProgress?.({ phase: 'validating', message: `${label}返回完成，正在校验结构…` });
      const parsed = schema.safeParse(raw);
      if (parsed.success) {
        onProgress?.({ phase: 'complete', message: `${label}结构校验通过。` });
        return parsed.data;
      }
      firstError ??= parsed.error;
      if (attempt === 1) {
        onProgress?.({ phase: 'retrying', message: '返回结构不完整，已自动发起一次修正。' });
      }
    }
    throw new ComposeValidationError(task, firstError);
  }
}
