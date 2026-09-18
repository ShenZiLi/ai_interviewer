export interface ScoreItem {
  report?: { overview: { avgScore: number } } | null;
}

/**
 * 取最近 N 场已出报告的综合分，按时序（旧→新）返回。
 * 入参 items 约定为按时间倒序（新→旧，与 /interviews 返回一致）。
 */
export function recentScores(items: ScoreItem[], count = 5): number[] {
  return items
    .filter((i) => i.report)
    .slice(0, count)
    .map((i) => Math.round(i.report!.overview.avgScore))
    .reverse();
}