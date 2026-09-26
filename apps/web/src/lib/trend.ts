import type { InterviewReport } from '../api';

export interface TrendDims {
  dim: string;
  displayScore?: number;
}

export interface TrendResult {
  avgDelta: number;
  dims: { dim: string; delta: number }[];
}

/** 计算「本场相对上一场」的趋势：综合分差值 + 各维差值（差值为 0 的维度省略）。 */
export function buildTrend(prev: InterviewReport, curAvg: number, curDims: TrendDims[]): TrendResult {
  const prevDims = prev.dimensionReport ?? [];
  const dims = curDims
    .map((d) => {
      const p = prevDims.find((x) => x.dim === d.dim);
      return { dim: d.dim, delta: p ? (d.displayScore ?? 0) - Math.round(p.overallScore * 20) : 0 };
    })
    .filter((x) => x.delta !== 0);
  return { avgDelta: Math.round(curAvg - prev.overview.avgScore), dims };
}