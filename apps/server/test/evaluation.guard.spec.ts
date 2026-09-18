import { describe, expect, it } from 'vitest';
import { buildDims, type Evaluation } from '@ai-interviewer/contracts';
import { normalizeEvaluation } from '../src/core/evaluation.guard.js';

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