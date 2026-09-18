/**
 * 通用枚举（对齐 docs/output-schemas.md 与 interface-and-data-model.md）
 */

/** 八维评分维度，顺序即默认展示顺序。 */
export const DIMS = [
  '切题与完整性',
  '专业准确性',
  '分析与推理',
  '方案与取舍',
  '项目深度与贡献',
  '证据与一致性',
  '表达与结构',
  '沟通与反思',
] as const;
export type Dim = (typeof DIMS)[number];

/** 提示词任务编码 P01—P10。 */
export const TASK_CODES = [
  'P01',
  'P02',
  'P03',
  'P04',
  'P05',
  'P06',
  'P07',
  'P08',
  'P09',
  'P10',
] as const;
export type TaskCode = (typeof TASK_CODES)[number];

/** 面试环节。 */
export const PHASES = ['intro', 'tech', 'biz', 'hr'] as const;
export type Phase = (typeof PHASES)[number];

/** 面试模式：陪练 / 模拟。 */
export const MODES = ['coach', 'mock'] as const;
export type Mode = (typeof MODES)[number];

/** 目标级别。 */
export const LEVELS = ['junior', 'mid', 'senior'] as const;
export type Level = (typeof LEVELS)[number];

/** 难度。 */
export const DIFFICULTIES = ['begin', 'mid', 'deep'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** 作答阶段：首次 / 获提示后。 */
export const ATTEMPT_STAGES = ['first', 'after_hint'] as const;
export type AttemptStage = (typeof ATTEMPT_STAGES)[number];

/** 录音保留策略。 */
export const RETENTIONS = ['request', 'session', 'forever', 'none'] as const;
export type Retention = (typeof RETENTIONS)[number];