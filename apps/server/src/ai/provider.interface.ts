import type { TaskCode } from '@ai-interviewer/contracts';

/**
 * 模型 / 语音供应商抽象（MVP：Mock 达成闭环；接入真实厂商时实现 HttpProvider / 语音网关）。
 * 每个任务返回 `asis as unknown`（未校验），由 ComposeService 依 taskSchema 校验。
 */
export interface Provider {
  readonly name: string;
  /** 对给定任务输出原始结果。MVP 的 Mock 返回合法样本；真实实现在此调用 vendor API。 */
  completeTask(_: { task: TaskCode; context: unknown }): Promise<unknown>;
  /** 可选的增量输出通道；HTTP Provider 用它转发模型 SSE 文本，Mock 可省略。 */
  streamTask?(_: { task: TaskCode; context: unknown; onDelta: (text: string) => void }): Promise<unknown>;
}

export interface VoiceGateway {
  readonly vendor: string;
  /** ASR：语音引用/文件 → 转写。MVP 返回占位文本。 */
  transcribe(_: { audioRef: string }): Promise<{ text: string; confidence: number }>;
  /** TTS：文本 → 音频引用/地址。MVP 返回占位地址。 */
  synthesize(_: { text: string; voice?: string }): Promise<{ audioRef: string; durationMs: number }>;
}
