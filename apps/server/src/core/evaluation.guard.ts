import { DIMS, gradeOf, overallScore, SELF_CONSISTENT_TOLERANCE, toDisplay, WEIGHTS, type Evaluation } from '@ai-interviewer/contracts';

/**
 * 评分业务规则 guard（对齐 docs/output-schemas.md §0）：
 * - displayScore 由内部 dim 分 ×20 由服务端计算，不信任模型给值。
 * - 整体分 score 若与八维加权的偏差 > 阈值，则以加权值为准重算，并标记 self_inconsistent。
 * - grade 一律由 gradeOf 派生，不信任模型给的等级。
 * 返回标准化后的评价副本（不原地改）。
 */
export function normalizeEvaluation(input: Evaluation): Evaluation {
  const ordered: number[] = DIMS.map((dim) => {
    const found = input.dims.find((d) => d.dim === dim);
    return found ? found.score : 0;
  });
  const weighted = overallScore(ordered);

  const dims = input.dims.map((d) => ({
    ...d,
    displayScore: Math.round(toDisplay(d.score)),
    weight: WEIGHTS[d.dim],
  }));

  const flags = new Set(input.flags ?? []);
  const score = Math.abs(input.score - weighted) <= SELF_CONSISTENT_TOLERANCE ? input.score : weighted;
  if (score !== input.score) flags.add('self_inconsistent');

  return { ...input, dims, score, grade: gradeOf(score), flags: [...flags] };
}