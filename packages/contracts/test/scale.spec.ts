import { describe, expect, it } from 'vitest';
import { overallScore, gradeOf, isSelfConsistent, toDisplay } from '../src/scale.js';
import { evaluationSchema } from '../src/schemas.js';

describe('整体分（加权 Σ(weight×dim)×20）', () => {
  it('八维全为 4 → 80 分', () => {
    const dims = [4, 4, 4, 4, 4, 4, 4, 4];
    expect(overallScore(dims)).toBe(80);
  });
  it('八维全为 5 → 100 分', () => {
    expect(overallScore([5, 5, 5, 5, 5, 5, 5, 5])).toBe(100);
  });
  it('输入长度非八抛错', () => {
    expect(() => overallScore([5, 5, 5])).toThrow(RangeError);
    expect(() => overallScore([5, 5, 5, 5, 5, 5, 5, 5, 5])).toThrow(RangeError);
  });
});

describe('等级映射（五档）', () => {
  it('边界：89→A，90→A+', () => {
    expect(gradeOf(89)).toBe('A');
    expect(gradeOf(90)).toBe('A+');
  });
  it('边界：79→B+，80→A', () => {
    expect(gradeOf(79)).toBe('B+');
    expect(gradeOf(80)).toBe('A');
  });
  it('边界：59→C，60→B', () => {
    expect(gradeOf(59)).toBe('C');
    expect(gradeOf(60)).toBe('B');
  });
});

describe('自洽校验（阈值 8）', () => {
  const dims = [4, 4, 4, 4, 4, 4, 4, 4]; // 加权=80
  it('score=80 一致', () => {
    expect(isSelfConsistent(80, dims)).toBe(true);
  });
  it('score=90 偏差10 不一致', () => {
    expect(isSelfConsistent(90, dims)).toBe(false);
  });
});

describe('展示刻度（内部 0–5 → 0–100）', () => {
  it('4 → 80，1 → 20', () => {
    expect(toDisplay(4)).toBe(80);
    expect(toDisplay(1)).toBe(20);
  });
});

describe('P07 evaluation schema', () => {
  it('校验合法评价通过', () => {
    const ok = evaluationSchema.safeParse({
      taskCode: 'P07',
      overall: '切题但深度不足',
      grade: 'B+',
      score: 72,
      dims: [
        { dim: '切题与完整性', score: 4, evidence: ['引用原话'] },
        { dim: '专业准确性', score: 4 },
        { dim: '分析与推理', score: 3.5 },
        { dim: '方案与取舍', score: 3 },
        { dim: '项目深度与贡献', score: 3 },
        { dim: '证据与一致性', score: 4 },
        { dim: '表达与结构', score: 4 },
        { dim: '沟通与反思', score: 4 },
      ],
      confidence: 0.81,
    });
    expect(ok.success).toBe(true);
  });
  it('拒绝非法维度分（如 4.2）', () => {
    const bad = evaluationSchema.safeParse({
      taskCode: 'P07',
      overall: 'x',
      grade: 'B',
      score: 70,
      dims: [{ dim: '专业准确性', score: 4.2 }],
      confidence: 0.5,
    });
    expect(bad.success).toBe(false);
  });
  it('拒绝未知维度', () => {
    const bad = evaluationSchema.safeParse({
      taskCode: 'P07',
      overall: 'x',
      grade: 'B',
      score: 70,
      dims: [{ dim: '回答完整性', score: 4 }],
      confidence: 0.5,
    });
    expect(bad.success).toBe(false);
  });
});