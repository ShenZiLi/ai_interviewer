import { DIMS } from './types.js';

/** 单维计分上限（0–5，可 0.5 步进）。 */
export const DIM_MAX = 5;

/**
 * 八维默认权重（偏专业与深度，Σ=1）。
 * 对齐 docs/output-schemas.md §0；可被后台量表覆盖，但定义必须与 DIMS 同序等长。
 */
export const WEIGHTS: Record<(typeof DIMS)[number], number> = {
  切题与完整性: 0.07,
  专业准确性: 0.2,
  分析与推理: 0.18,
  方案与取舍: 0.17,
  项目深度与贡献: 0.15,
  证据与一致性: 0.08,
  表达与结构: 0.08,
  沟通与反思: 0.07,
};

/** 整体分与八维加权值的自洽校验阈值。 */
export const SELF_CONSISTENT_TOLERANCE = 8;

/** 展示刻度：内部 0–5 → 展示 0–100。 */
export function toDisplay(dimScore: number): number {
  return round1((dimScore / DIM_MAX) * 100);
}

/**
 * 整体分 = Σ(weight_i × dim_i) × 20（dim_i 为 0–5）。
 * scores 须为八维、与 DIMS 同序；非 0–5 值不做静默钳制，交由调用方/校验处理。
 */
export function overallScore(scores: number[]): number {
  requireNormalizedLength(scores);
  let sum = 0;
  for (let i = 0; i < scores.length; i++) sum += WEIGHTS[DIMS[i]] * scores[i];
  return round1(sum * 20);
}

/** 整体分 → 等级（五档）。 */
export function gradeOf(score: number): 'A+' | 'A' | 'B+' | 'B' | 'C' {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B+';
  if (score >= 60) return 'B';
  return 'C';
}

/** 自洽校验：|score − 加权值| > 阈值 视为不一致。 */
export function isSelfConsistent(score: number, scores: number[]): boolean {
  return Math.abs(score - overallScore(scores)) <= SELF_CONSISTENT_TOLERANCE;
}

function requireNormalizedLength(scores: number[]): void {
  if (scores.length !== DIMS.length) {
    throw new RangeError(`scores 长度必须等于 ${DIMS.length}：${scores.length}`);
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}