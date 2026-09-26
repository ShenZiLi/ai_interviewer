import { Inject, Injectable } from '@nestjs/common';
import { taskSchema, type TaskCode } from '@ai-interviewer/contracts';
import type { Provider } from './provider.interface.js';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** compose 输出校验失败（含重试后仍失败）。 */
export class ComposeValidationError extends Error {
  constructor(
    public readonly task: TaskCode,
    cause: unknown,
    public readonly kind: 'output' | 'upstream' = 'output',
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
      P01: '简历', P02: '岗位匹配', P03: '考察方向', P04: '面试大纲', P07: '回答评价', P08: '追问决策',
    };
    const label = taskLabel[task] ?? task;
    let firstError: unknown;
    let repairInstruction: string | undefined;
    let previousOutput: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      onProgress?.({ phase: 'requesting', message: attempt === 1 ? `正在请求模型处理${label}…` : `正在按结构要求重新生成${label}…` });
      let raw: unknown;
      try {
        const attemptContext = attempt === 2 && context && typeof context === 'object' && !Array.isArray(context)
          ? { ...context as Record<string, unknown>, repairInstruction, previousOutput }
          : context;
        raw = this.provider.streamTask
          ? await this.provider.streamTask({ task, context: attemptContext, onDelta: (text) => onProgress?.({ phase: 'delta', message: text }) })
          : await this.provider.completeTask({ task, context: attemptContext });
      } catch (err) {
        if (attempt === 1) {
          repairInstruction = `上一轮请求失败：${String((err as Error)?.message ?? err).slice(0, 500)}。请重新生成完整 JSON。`;
          onProgress?.({ phase: 'retrying', message: '模型请求异常，正在自动重试一次…' });
          continue;
        }
        throw new ComposeValidationError(task, err, 'upstream');
      }
      onProgress?.({ phase: 'validating', message: `${label}返回完成，正在校验结构…` });
      const parsed = schema.safeParse(raw);
      if (parsed.success) {
        onProgress?.({ phase: 'complete', message: `${label}结构校验通过。` });
        return parsed.data;
      }
      firstError ??= parsed.error;
      previousOutput = raw;
      repairInstruction = `上一次 JSON 未通过字段校验。错误清单：${parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.') || '根对象'}：${issue.message}`).join('；')}。请保留已有正确字段，修正后输出完整 JSON。`;
      if (attempt === 1) {
        onProgress?.({ phase: 'retrying', message: '返回结构不完整，已自动发起一次修正。' });
      }
    }
    throw new ComposeValidationError(task, firstError);
  }
}
