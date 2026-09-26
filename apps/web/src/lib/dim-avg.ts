import { DIMS } from '@ai-interviewer/contracts';

export interface DimAvg {
  dim: string;
  displayScore: number;
}

/**
 * 聚合多场已完成报告的八维（内部 0–5 → 展示 0–100），按契约 DIMS 顺序输出。
 * 仅统计被考察过的维度；无任何维度数据时返回空数组。
 */
export function avgDims(reports: { dimensionReport?: { dim: string; overallScore: number }[] }[]): DimAvg[] {
  const byDim = new Map<string, number[]>();
  for (const r of reports) {
    for (const d of r.dimensionReport ?? []) {
      const acc = byDim.get(d.dim) ?? [];
      acc.push(d.overallScore);
      byDim.set(d.dim, acc);
    }
  }
  const avgOf = (vals: number[]) => Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 20);
  return [...byDim.entries()]
    .map(([dim, vals]) => ({ dim, displayScore: avgOf(vals) }))
    .sort((a, b) => DIMS.indexOf(a.dim as (typeof DIMS)[number]) - DIMS.indexOf(b.dim as (typeof DIMS)[number]));
}
