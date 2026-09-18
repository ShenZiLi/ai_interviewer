import { describe, expect, it } from 'vitest';
import { buildDims, DIMS, type Evaluation, type SessionReport } from '@ai-interviewer/contracts';
import { normalizeEvaluation, normalizeSessionReport } from '../src/core/evaluation.guard.js';

function base(score: number): Evaluation {
  return {
    taskCode: 'P07',
    overall: 'x',
    grade: 'B',
    score,
    dims: buildDims([4, 4, 4, 4, 4, 4, 4, 4]).map((d) => ({ ...d })),
    confidence: 0.8,
    flags: [],
  };
}

describe('normalizeEvaluation 评分业务规则', () => {
  it('自洽时保留 score 并派生 displayScore/weight', () => {
    const ev = normalizeEvaluation(base(80));
    expect(ev.score).toBe(80);
    expect(ev.grade).toBe('A');
    expect(ev.flags).not.toContain('self_inconsistent');
    expect(ev.dims.every((d) => d.displayScore === 80)).toBe(true);
    expect(ev.dims.every((d) => typeof d.weight === 'number')).toBe(true);
  });

  it('不自洽时以加权值为准重算，并标记 self_inconsistent', () => {
    const ev = normalizeEvaluation(base(95));
    expect(ev.score).toBe(80); // 八维全 4 → 加权 80
    expect(ev.grade).toBe('A');
    expect(ev.flags).toContain('self_inconsistent');
  });

  it('缺维度按 0 计，不影响归一不抛错', () => {
    const ev = normalizeEvaluation({
      ...base(60),
      dims: [{ dim: '专业准确性', score: 4 }],
    });
    expect(ev.score).toBeGreaterThan(0);
  });
});

describe('normalizeSessionReport 整场报告与逐题八维自洽', () => {
  const turns = (dims: number[]): { attempts: { stage: string; transcript: string; evaluation: Evaluation }[] }[] => [
    { attempts: [{ stage: 'first', transcript: 'a', evaluation: { ...base(60), dims: buildDims(dims) } }] },
  ];
  const report: SessionReport = {
    taskCode: 'P10',
    overview: { mode: 'coach', directionCoverage: { covered: 1, planned: 2 }, durationUsedMinutes: 26, completedAnswers: 1, avgScore: 40 },
    dimensionReport: DIMS.map((dim, i) => ({ dim, overallScore: [2, 2, 2, 2, 2, 2, 2, 2][i], trend: 'flat' })),
    highlight: { bestAnswer: { turnRef: 'turn:1', why: 'x' }, improvementStart: { turnRef: 'turn:1', why: 'y' } },
    actionPlan: [{ area: 'X', suggestion: 's', priority: 'high' }],
    confidence: 0.8,
  };

  it('模型报告与实际逐题有偏差时，avgScore 与 dimensionReport 重算为实测聚合', () => {
    // 逐题八维全 4 → 加权 80；模型声称 40，将被纠正为 80。
    const out = normalizeSessionReport(report, turns([4, 4, 4, 4, 4, 4, 4, 4]));
    expect(out.overview.avgScore).toBe(80);
    expect(out.overview).toMatchObject({ completedAnswers: 1, durationUsedMinutes: 26 });
    expect(out.dimensionReport.every((d) => d.overallScore === 4)).toBe(true);
    expect(out.highlight.bestAnswer.why).toBe('x'); // 定性字段保留
    expect(out.actionPlan[0].area).toBe('X');
  });

  it('无实测数据（模拟模式）原样返回', () => {
    const out = normalizeSessionReport(report, []);
    expect(out).toBe(report);
  });

  it('overview.avgScore 与 dimensionReport 加权聚合自洽', () => {
    const dims = [5, 4, 4, 5, 3, 3, 4, 3];
    const out = normalizeSessionReport(report, turns(dims));
    const recomputed = Math.round(DIMS.reduce((acc, dim, i) => acc + out.dimensionReport[i].overallScore * (({ 切题与完整性: 0.07, 专业准确性: 0.2, 分析与推理: 0.18, 方案与取舍: 0.17, 项目深度与贡献: 0.15, 证据与一致性: 0.08, 表达与结构: 0.08, 沟通与反思: 0.07 } as Record<string, number>)[dim]), 0) * 20);
    expect(out.overview.avgScore).toBe(recomputed);
  });
});