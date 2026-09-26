export interface ScoreItem {
  updatedAt?: string;
  report?: { overview: { avgScore: number } } | null;
}

export interface ScorePoint {
  /** 综合分（已四舍五入）。 */
  value: number;
  /** X 轴标签（如 "MM-DD"），用于折线图横坐标。 */
  label: string;
}

/** 从完整时间戳取 "MM-DD"，无有效时间戳时返回空串（调用方用场次序号兜底）。 */
function shortLabel(updatedAt: string | undefined): string {
  if (!updatedAt) return '';
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 取最近 N 场已出报告的综合分与日期标签，按时序（旧→新）返回。
 * 入参 items 约定为按时间倒序（新→旧，与 /interviews 返回一致）；
 * 返回值按正序排列，便于折线图按时间趋势渲染；无有效时间戳时以场次序号兜底。
 */
export function recentScores(items: ScoreItem[], count = 5): ScorePoint[] {
  return items
    .filter((i) => i.report)
    .slice(0, count)
    .map((i) => ({ value: Math.round(i.report!.overview.avgScore), label: shortLabel(i.updatedAt) }))
    .reverse()
    .map((p, idx) => (p.label ? p : { value: p.value, label: `#${idx + 1}` }));
}