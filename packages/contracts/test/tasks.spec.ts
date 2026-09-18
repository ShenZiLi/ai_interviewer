import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  taskSchemas,
  resumeSchema,
  positionSchema,
  directionsSchema,
  outlineSchema,
  outlineAdjustSchema,
  mainQuestionSchema,
  evaluationSchema,
  followUpSchema,
  coachingSchema,
  reportSchema,
} from '../src/schemas.js';

const valid = {
  P01: {
    summary: '三年 Java 后端',
    candidateName: '林同学',
    education: [{ school: 'S', degree: '本科', major: 'CS', period: '2018-2022' }],
    skills: [{ name: 'Java' }],
    confidence: 0.9,
  },
  P02: {
    role: 'Java 后端',
    seniority: 'mid',
    requiredSkills: ['Java', '并发'],
    focusAreas: ['高并发'],
    summary: '…',
    confidence: 0.8,
  },
  P03: {
    recommendedDirections: [
      { id: 'concurrency', name: '并发/多线程', weight: 0.9 },
      { id: 'distributed', name: '分布式事务', weight: 0.7 },
    ],
    confidence: 0.78,
  },
  P04: {
    summary: '…',
    durationPlan: { tier: '30m', budgetMinutes: 30, phases: [{ phase: 'tech', minutes: 30, questionCount: 3 }] },
    outline: [
      { topic: '并发控制', mainQuestion: '如何保证不超卖？', difficulty: 'mid', followUpPlan: { depth: 3 } },
    ],
    confidence: 0.8,
  },
  P05: {
    changes: [{ type: 'add', after: '新增微服务深挖', reason: '…' }],
    newlyNoted: [{ fact: '熟悉 Kafka', appliedTo: 'tech' }],
    mode: 'auto',
    confidence: 0.85,
  },
  P06: {
    questionText: '如何保证不超卖？',
    topic: '分布式事务',
    difficulty: 'mid',
    targetAspect: '方案权衡',
    confidence: 0.86,
  },
  P07: {
    taskCode: 'P07',
    overall: '切题但深度不足',
    grade: 'B+',
    score: 72,
    dims: [
      { dim: '切题与完整性', score: 4 },
      { dim: '专业准确性', score: 4 },
      { dim: '分析与推理', score: 3.5 },
      { dim: '方案与取舍', score: 3 },
      { dim: '项目深度与贡献', score: 3 },
      { dim: '证据与一致性', score: 4 },
      { dim: '表达与结构', score: 4 },
      { dim: '沟通与反思', score: 4 },
    ],
    confidence: 0.81,
  },
  P08: {
    shouldAsk: true,
    decidedBy: 'depth',
    questions: [{ text: '并发翻倍呢？', purpose: '考察扩容', difficulty: 'deep' }],
    maxDepthReached: false,
    nextStep: 'followup',
    confidence: 0.81,
  },
  P09: {
    modelAnswer: { summary: '先给结论', structure: [{ point: '结论', explanation: '…' }] },
    optimization: [{ userPoint: '…', improved: '…', why: '…' }],
    confidence: 0.74,
  },
  P10: {
    overview: { mode: 'coach', directionCoverage: { covered: 2, planned: 3 }, durationUsedMinutes: 28, completedAnswers: 4, avgScore: 78.5 },
    dimensionReport: [{ dim: '专业准确性', overallScore: 4, trend: 'up' }],
    highlight: { bestAnswer: { turnRef: 'turn:1', why: '…' }, improvementStart: { turnRef: 'turn:2', why: '…' } },
    actionPlan: [{ area: '表达', suggestion: '…', priority: 'high' }],
    confidence: 0.83,
  },
} as const;

const schemas: Record<string, z.ZodTypeAny> = {
  P01: resumeSchema,
  P02: positionSchema,
  P03: directionsSchema,
  P04: outlineSchema,
  P05: outlineAdjustSchema,
  P06: mainQuestionSchema,
  P07: evaluationSchema,
  P08: followUpSchema,
  P09: coachingSchema,
  P10: reportSchema,
};

describe('P01—P10 schema 校验', () => {
  it('其余任务在注册表中存在且类型可解析', () => {
    for (const code of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P08', 'P09', 'P10'] as const) {
      expect(taskSchemas[code], code).toBeDefined();
    }
  });
  it('各任务合法样例通过', () => {
    for (const [code, schema] of Object.entries(schemas)) {
      const r = (schema as unknown as { safeParse: (v: unknown) => { success: boolean } }).safeParse(
        valid[code as keyof typeof valid],
      );
      expect(r.success, code).toBe(true);
    }
  });
  it('各任务缺失必填字段的样例被拒则证明必填约束生效', () => {
    // 用最小破坏：P01 缺 summary
    expect(resumeSchema.safeParse({ ...valid.P01, summary: undefined }).success).toBe(false);
    // P03 方向少于 2 项
    expect(directionsSchema.safeParse({ ...valid.P03, recommendedDirections: [valid.P03.recommendedDirections[0]] }).success).toBe(false);
    // P04 时长超预算
    expect(
      outlineSchema.safeParse({
        ...valid.P04,
        durationPlan: { ...valid.P04.durationPlan, phases: [{ phase: 'tech', minutes: 31, questionCount: 3 }] },
      }).success,
    ).toBe(true); // 说明：schemas 只校验结构；Σ≤预算 由编排层校验，不在此处。
    // P07 非法维度分
    expect(
      evaluationSchema.safeParse({ ...valid.P07, dims: [{ dim: '专业准确性', score: 4.2 }] }).success,
    ).toBe(false);
  });
});