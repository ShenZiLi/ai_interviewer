import { DIMS, gradeOf, SELF_CONSISTENT_TOLERANCE, toDisplay, WEIGHTS, type Evaluation, type SessionReport } from '@ai-interviewer/contracts';

/**
 * 评分业务规则 guard（对齐 docs/output-schemas.md §0）：
 * - displayScore 由内部 dim 分 ×20 由服务端计算，不信任模型给值。
 * - 整体分 score 若与八维加权的偏差 > 阈值，则以加权值为准重算，并标记 self_inconsistent。
 * - grade 一律由 gradeOf 派生，不信任模型给的等级。
 * 返回标准化后的评价副本（不原地改）。
 */
export function normalizeEvaluation(input: Evaluation): Evaluation {
  // 只统计被考察到的维度（未考察项不计零分，避免缺维拖低整体分）。
  const assessed = input.dims.filter((d): d is (typeof d & { score: number }) => DIMS.includes(d.dim) && typeof d.score === 'number');
  const weightSum = assessed.reduce((s, d) => s + WEIGHTS[d.dim], 0);
  const weighted = weightSum > 0 ? Math.round((assessed.reduce((s, d) => s + WEIGHTS[d.dim] * d.score, 0) / weightSum) * 200) / 10 : 0;

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

/**
 * 整场报告 guard：在存在逐题实测（P07）时，将 overview.avgScore 与 dimensionReport 重算为
 * 八维实测的聚合（每题取末次作答），保证整场分数与逐题成绩自洽（同 mock P10 口径）。
 * 保留模型的定性字段（mode/coverage/时长/highlight/actionPlan/trend 等）；
 * 无实测数据时原样返回。返回副本，不原地改。
 */
export function normalizeSessionReport(report: SessionReport, turns: { topic?: string; attempts?: { evaluation?: unknown }[] }[]): SessionReport {
  const perTurn: Evaluation[] = [];
  const answeredTopic = new Set<string>();
  for (const t of turns) {
    const attempts = t.attempts ?? [];
    const last = attempts[attempts.length - 1];
    if (last?.evaluation) {
      perTurn.push(last.evaluation as Evaluation);
      if (t.topic) answeredTopic.add(t.topic);
    }
  }
  if (!perTurn.length) return report;

  const dimScores: (number | null)[] = DIMS.map((dim) => {
    const vals = perTurn.map((e) => e.dims.find((d) => d.dim === dim)?.score).filter((n): n is number => typeof n === 'number');
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 2) / 2; // 收敛到 0.5 步进
  });
  if (dimScores.some((s) => s === null)) return report;

  const scores = (dimScores as number[]).slice();
  let sum = 0;
  DIMS.forEach((dim, i) => { sum += WEIGHTS[dim] * scores[i]; });
  const avgScore = Math.round(sum * 20);

  const trendOf = new Map<string, SessionReport['dimensionReport'][number]['trend']>(report.dimensionReport.map((d) => [d.dim, d.trend]));
  const dimensionReport = DIMS.map((dim, i) => ({ dim, overallScore: scores[i], trend: trendOf.get(dim) ?? 'flat' })) as SessionReport['dimensionReport'];

  const covered = Math.min(answeredTopic.size, report.overview.directionCoverage.planned);

  return {
    ...report,
    overview: {
      ...report.overview,
      avgScore,
      completedAnswers: perTurn.length,
      directionCoverage: { ...report.overview.directionCoverage, covered },
    },
    dimensionReport,
  };
}