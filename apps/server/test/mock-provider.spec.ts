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
    expect(a.dims.map((d) => d.score)).toEqual(a2.dims.map((d) => d.score));
    const same = a.dims.every((d, i) => d.score === b.dims[i]?.score);
    expect(same).toBe(false);
  });

  it('不同作答内容的整场报告综合分不同 → 复盘「vs 上一场」趋势可见', async () => {
    const p = new MockProvider();
    const mkReport = async (transcript: string) => {
      const ev = (await p.completeTask({ task: 'P07', context: { transcript } })) as { dims: { dim: string; score: number }[] };
      return (await p.completeTask({
        task: 'P10',
        context: { it: { kind: 'coach', durationTier: '30m', outline: { outline: [{ topic: 't', mainQuestion: 'q' }] }, turns: [{ topic: 't', attempts: [{ stage: 'first', transcript, evaluation: ev }] }] } },
      })) as { overview: { avgScore: number }; dimensionReport: { dim: string; overallScore: number }[] };
    };
    const ra = await mkReport('我会考虑分布式锁并做好幂等。');
    const rb = await mkReport('先给结论再给约束。');
    // 两端断言：综合分不同，且至少一个维度分不同（趋势面板有可展示差值）。
    expect(ra.overview.avgScore).not.toBe(rb.overview.avgScore);
    expect(ra.dimensionReport.some((d, i) => d.overallScore !== rb.dimensionReport[i]?.overallScore)).toBe(true);
  });

  it('P06 主问题按阶段与同阶段序号轮转（避免全场同一题）', async () => {
    const p = new MockProvider();
    const ask = async (phase: string, turns: { phase: string }[]) =>
      (await p.completeTask({ task: 'P06', context: { it: { turns }, phase } })) as { questionText: string; topic: string; difficulty: string; targetAspect?: string };
    const tech1 = await ask('tech', []);
    const tech2 = await ask('tech', [{ phase: 'tech' }]);
    const biz1 = await ask('biz', []);
    const hr1 = await ask('hr', []);
    // 同阶段序号不同 → 问题轮转
    expect(tech1.questionText).not.toBe(tech2.questionText);
    // 不同阶段 → 题目不同，且各自带主题/难度/考察维度
    expect(biz1.questionText).not.toBe(hr1.questionText);
    expect(tech1.topic).toBeTruthy();
    expect(['begin', 'mid', 'deep']).toContain(tech1.difficulty);
    expect(tech1.targetAspect).toBeTruthy();
  });

  it('P04 大纲按所选方向取题（只选缓存方向 → 题目与覆盖方向一致）', async () => {
    const p = new MockProvider();
    const onlyCache = (await p.completeTask({ task: 'P04', context: { it: { directions: ['cacheredis'] } } })) as { outline: { topic: string; mainQuestion: string }[]; coveredDirections: string[] };
    expect(onlyCache.outline.length).toBeGreaterThanOrEqual(1);
    expect(onlyCache.outline.every((q) => q.topic === '缓存一致性')).toBe(true);
    expect(onlyCache.coveredDirections).toEqual(['cacheredis']);
    // 全选/未选 → 回落到完整 tech 题库（≥ 并发控制 主题）
    const all = (await p.completeTask({ task: 'P04', context: { it: { directions: ['concurrency', 'distributed', 'cacheredis'] } } })) as { outline: { topic: string }[] };
    expect(all.outline.some((q) => q.topic === '并发控制')).toBe(true);
  });

  it('方向覆盖按已作答主题去重计（同一主题多轮只算一次）', async () => {
    const p = new MockProvider();
    const ev = { dims: DIMS.map((dim, i) => ({ dim, score: 4 })) };
    const sameTopic = (await p.completeTask({
      task: 'P10', context: { it: { kind: 'coach', durationTier: '45m', outline: { outline: [{ topic: 'a', mainQuestion: 'q1' }, { topic: 'b', mainQuestion: 'q2' }] }, turns: [{ topic: 'a', attempts: [{ evaluation: ev }] }, { topic: 'a', attempts: [{ evaluation: ev }] }, { topic: 'b', attempts: [{ evaluation: ev }] }] } },
    })) as { overview: { directionCoverage: { covered: number; planned: number }; completedAnswers: number } };
    expect(sameTopic.overview.completedAnswers).toBe(3);
    expect(sameTopic.overview.directionCoverage).toEqual({ covered: 2, planned: 2 });
  });

  it('整场时长以开考至今计并钳制在档位预算内', async () => {
    const p = new MockProvider();
    const longAgo = new Date(Date.UTC(2020, 0, 1)).toISOString();
    const r = (await p.completeTask({ task: 'P10', context: { it: { kind: 'coach', durationTier: '30m', startedAt: longAgo } } })) as { overview: { durationUsedMinutes: number } };
    expect(r.overview.durationUsedMinutes).toBeLessThanOrEqual(30);
    expect(r.overview.durationUsedMinutes).toBeGreaterThan(0);
  });
});