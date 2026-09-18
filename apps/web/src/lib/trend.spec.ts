import { describe, expect, it } from 'vitest';
import { buildTrend } from './trend';

/** 单一纯函数：复盘报告「vs 上一场」的差值计算。 */
describe('buildTrend', () => {
  it('综合分与各维差值正确，差值为 0 的维度被省略', () => {
    const prev = {
      overview: { avgScore: 77.5, completedAnswers: 3, directionCoverage: { covered: 3, planned: 5 } },
      dimensionReport: [
        { dim: '专业准确性', overallScore: 4 }, // display 80
        { dim: '方案与取舍', overallScore: 3.75 }, // display 75
      ],
    };
    const curDims = [
      { dim: '专业准确性', displayScore: 95 },
      { dim: '方案与取舍', displayScore: 70 },
      { dim: '项目深度与贡献', displayScore: 60 }, // 上一场无此维 → 差值为 0 → 省略
    ];
    const t = buildTrend(prev, 82, curDims);
    expect(t.avgDelta).toBe(5); // Math.round(82 - 77.5)
    expect(t.dims).toEqual([
      { dim: '专业准确性', delta: 15 },
      { dim: '方案与取舍', delta: -5 },
    ]);
  });

  it('上一场无维度数据时各维差值为 0，仍返回综合分差值', () => {
    const prev = { overview: { avgScore: 70, completedAnswers: 2, directionCoverage: { covered: 2, planned: 4 } } };
    const t = buildTrend(prev, 66, [{ dim: '分析与推理', displayScore: 60 }]);
    expect(t.avgDelta).toBe(-4);
    expect(t.dims).toEqual([]);
  });

  it('无上一场可比（同分同维）时 dims 为空', () => {
    const prev = {
      overview: { avgScore: 80, completedAnswers: 1, directionCoverage: { covered: 1, planned: 1 } },
      dimensionReport: [{ dim: '表达与结构', overallScore: 4 }],
    };
    const t = buildTrend(prev, 80, [{ dim: '表达与结构', displayScore: 80 }]);
    expect(t.avgDelta).toBe(0);
    expect(t.dims).toEqual([]);
  });
});