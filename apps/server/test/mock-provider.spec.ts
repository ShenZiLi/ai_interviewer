import { describe, expect, it } from 'vitest';
import { MockProvider } from '../src/ai/mock.provider.js';
import { DIMS, WEIGHTS } from '@ai-interviewer/contracts';

function ctx(turns: { dims: number[] }[]) {
  return {
    it: {
      kind: 'coach',
      durationTier: '30m',
      outline: { outline: [{ topic: 't1', mainQuestion: 'q1' }, { topic: 't2', mainQuestion: 'q2' }, { topic: 't3', mainQuestion: 'q3' }] },
      turns: turns.map((t) => ({
        attempts: [{ stage: 'first', transcript: 'x', evaluation: { dims: DIMS.map((dim, i) => ({ dim, score: t.dims[i] })) } }],
      })),
    },
  };
}

const agg = (dims: number[]) => Math.round(DIMS.reduce((acc, dim, i) => acc + WEIGHTS[dim] * dims[i], 0) * 20);

describe('MockProvider P10 整场报告与逐题八维自洽', () => {
  it('用逐题实测八维聚合，avgScore = Σ(weight×dim)×20', async () => {
    const p = new MockProvider();
    const dims = [4, 4, 3.5, 3.5, 3, 3, 4, 3];
    const report = (await p.completeTask({ task: 'P10', context: ctx([{ dims }, { dims }]) })) as {
      overview: { mode: string; completedAnswers: number; avgScore: number; directionCoverage: { covered: number; planned: number } };
      dimensionReport: { dim: string; overallScore: number }[];
    };
    expect(report.overview.mode).toBe('coach');
    expect(report.overview.completedAnswers).toBe(2);
    expect(report.overview.avgScore).toBe(agg(dims));
    // 每维取两题均值（应相等），与 avgScore 加权聚合自洽
    expect(report.overview.avgScore).toBe(Math.round(DIMS.reduce((acc, dim, i) => acc + WEIGHTS[dim] * report.dimensionReport[i].overallScore, 0) * 20));
  });

  it('更高分作答 → 整场报告相应更高', async () => {
    const p = new MockProvider();
    const weak = [3, 3, 3, 3, 3, 3, 3, 3];
    const strong = [5, 5, 5, 5, 5, 5, 5, 5];
    const weakR = (await p.completeTask({ task: 'P10', context: ctx([{ dims: weak }]) })) as { overview: { avgScore: number } };
    const strongR = (await p.completeTask({ task: 'P10', context: ctx([{ dims: strong }]) })) as { overview: { avgScore: number } };
    expect(weakR.overview.avgScore).toBe(60);
    expect(strongR.overview.avgScore).toBe(100);
  });

  it('无实测数据（模拟模式）回退固定样本', async () => {
    const p = new MockProvider();
    const report = (await p.completeTask({ task: 'P10', context: { it: { kind: 'mock', turns: [{ attempts: [{ stage: 'first', transcript: 'x' }] }] } } })) as { dimensionReport: { dim: string; overallScore: number }[] };
    expect(report.dimensionReport.length).toBe(DIMS.length);
  });
});

describe('MockProvider P07 随作答内容确定性变化', () => {
  it('不同作答内容给出不同维度分，且同文本结果确定', async () => {
    const p = new MockProvider();
    const a = (await p.completeTask({ task: 'P07', context: { transcript: '我会考虑分布式锁并做好幂等。' } })) as { dims: { dim: string; score: number }[] };
    const b = (await p.completeTask({ task: 'P07', context: { transcript: '先给结论再给约束。' } })) as { dims: { dim: string; score: number }[] };
    const a2 = (await p.completeTask({ task: 'P07', context: { transcript: '我会考虑分布式锁并做好幂等。' } })) as { dims: { dim: string; score: number }[] };
    // 同文本 → 确定（等值）
    expect(a.dims.map((d) => d.score)).toEqual(a2.dims.map((d) => d.score));
    // 不同文本 → 至少有一个维度分不同（体现个性化）
    const same = a.dims.every((d, i) => d.score === b.dims[i]?.score);
    expect(same).toBe(false);
  });
});