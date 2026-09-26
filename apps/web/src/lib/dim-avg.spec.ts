import { describe, expect, it } from 'vitest';
import { avgDims } from './dim-avg';

describe('avgDims 多场八维聚合', () => {
  it('按维度平均并转 0–100 展示，按契约 DIMS 顺序输出', () => {
    const out = avgDims([
      { dimensionReport: [{ dim: '专业准确性', overallScore: 4 }, { dim: '方案与取舍', overallScore: 3 }, { dim: '表达与结构', overallScore: 4 }] },
      { dimensionReport: [{ dim: '专业准确性', overallScore: 5 }, { dim: '方案与取舍', overallScore: 3.5 }] },
    ]);
    const byName = Object.fromEntries(out.map((d) => [d.dim, d.displayScore]));
    expect(byName['专业准确性']).toBe(90); // (4+5)/2 × 20
    expect(byName['方案与取舍']).toBe(65); // (3+3.5)/2 × 20
    expect(byName['表达与结构']).toBe(80); // 仅一场
    // 顺序与 DIMS 一致：专业准确性应排在前，表达与结构在后
    expect(out.map((d) => d.dim)).toEqual(['专业准确性', '方案与取舍', '表达与结构']);
  });

  it('无任何维度数据时返回空数组', () => {
    expect(avgDims([])).toEqual([]);
    expect(avgDims([{ dimensionReport: [] }])).toEqual([]);
  });
});
