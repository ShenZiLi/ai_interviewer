import { Injectable } from '@nestjs/common';
import { buildDims, DIMS } from '@ai-interviewer/contracts';
import type { Provider, VoiceGateway } from './provider.interface.js';

/**
 * MVP Mock 供应商：返回结构化合法样本，使 P01—P10 全流程可闭环、可测试。
 * 接真实厂商时以此实现替换（env 切换），compose 输出仍由 taskSchema 校验。
 */
@Injectable()
export class MockProvider implements Provider {
  readonly name = 'mock';

  async completeTask({ task, context }: { task: string; context: unknown }): Promise<unknown> {
    void context;
    switch (task) {
      case 'P01':
        return {
          summary: '三年 Java 后端经验，熟悉高并发与分布式。',
          candidateName: '林同学',
          education: [{ school: '示例大学', degree: '本科', major: '计算机科学与技术', period: '2018-2022' }],
          experiences: [
            { company: '示例电商', role: '后端开发', period: '2021-至今', bullets: ['负责订单接口与库存扣减改造'] },
          ],
          projects: [
            {
              name: '订单与库存服务',
              role: '后端',
              stack: ['Java', 'Spring Boot', 'MySQL', 'Redis', 'MQ'],
              points: ['促销库存扣减改造', '参与压测与重复下单处理'],
            },
          ],
          skills: [{ name: 'Java', level: '进阶' }, { name: 'Spring Boot' }],
          gaps: [{ field: '个人贡献边界', note: '建议在不给建议的情况下由用户补充' }],
          confidence: 0.9,
        };
      case 'P02':
        return {
          role: 'Java 后端工程师',
          seniority: 'mid',
          requiredSkills: ['Java', '并发', '分布式'],
          preferredSkills: ['K8s'],
          focusAreas: ['高并发设计', '分布式事务'],
          summary: '目标是夯实 Java 后端高并发与分布式基础。',
          confidence: 0.82,
        };
      case 'P03':
        return {
          recommendedDirections: [
            { id: 'concurrency', name: '并发 / 多线程', weight: 0.9, reason: '岗位与简历均涉及高并发' },
            { id: 'distributed', name: '分布式事务', weight: 0.7, reason: '库存扣减跨服务场景' },
            { id: 'cacheredis', name: '缓存与一致性', weight: 0.6, reason: 'Redis 使用经历' },
          ],
          pendingClarify: [{ question: '更看重原理考核还是项目深挖？', options: ['原理', '项目'] }],
          confidence: 0.78,
        };
      case 'P04':
        return {
          summary: '围绕并发与分布式展开 30 分钟标准面试。',
          durationPlan: { tier: '30m', budgetMinutes: 30, phases: [{ phase: 'tech', minutes: 18, questionCount: 3, focus: ['并发', '分布式'] }, { phase: 'biz', minutes: 8, questionCount: 1, focus: ['项目取舍'] }, { phase: 'hr', minutes: 4, questionCount: 1, focus: ['离职原因'] }] },
          outline: [
            { topic: '并发控制', mainQuestion: '在线购物结算如何保证不超卖？', difficulty: 'mid', followUpPlan: { depth: 3, branches: ['内存模型', '锁'] } },
            { topic: '分布式事务', mainQuestion: '跨服务扣库存与下单如何保证一致？', difficulty: 'mid', followUpPlan: { depth: 3, branches: ['本地消息表', 'TCC'] } },
          ],
          coveredDirections: ['concurrency', 'distributed'],
          confidence: 0.8,
        };
      case 'P05':
        return {
          changes: [{ type: 'add', ref: 'project_orders', after: '新增幂等设计追问', reason: '自我介绍提及重复下单处理' }],
          newlyNoted: [{ fact: '熟悉 Kafka', appliedTo: 'tech' }],
          mode: 'auto',
          confidence: 0.85,
        };
      case 'P06':
        return {
          questionText: '在线购物结算如何保证不超卖？',
          topic: '并发控制',
          difficulty: 'mid',
          targetAspect: '方案取舍',
          probePoints: [{ purpose: '考察部署边界', hint: '多实例时本地锁是否有效' }],
          biasToDirections: ['concurrency'],
          contextUsed: ['简历项目：库存扣减'],
          confidence: 0.86,
        };
      case 'P07':
        return {
          taskCode: 'P07',
          overall: '切题但深度不足，未说清多实例边界。',
          grade: 'B',
          score: 68,
          dims: buildDims([3, 4, 3.5, 3, 3, 4, 4, 4]).map((d) => ({ ...d, evidence: ['引用回答片段'] })),
          strengths: ['先识别了问题并给出思路'],
          weaknesses: ['缺少适用前提与失败处理'],
          suggestions: [{ title: '补充部署边界', body: '先说明多实例，再比较分布式锁与数据库条件更新。' }],
          misconceptions: [{ quote: '本地锁能覆盖多实例', clarification: '本地锁仅单进程内有效', kind: 'knowledge' }],
          followUpHint: { recommended: true, reason: '可追问边界条件' },
          confidence: 0.79,
          flags: [],
        };
      case 'P08':
        return {
          shouldAsk: true,
          decidedBy: 'depth',
          questions: [{ text: '如果并发再翻一倍呢？', purpose: '考察扩容与一致性取舍', difficulty: 'deep', relationToPrev: '加深' }],
          maxDepthReached: false,
          nextStep: 'followup',
          confidence: 0.81,
        };
      case 'P09':
        return {
          modelAnswer: { summary: '按“背景→约束→方案→失败处理”作答', structure: [{ point: '明确部署边界', explanation: '多实例下本地锁无效' }] },
          optimization: [{ userPoint: '直接给 synchronized', improved: '先说部署与并发量，再选方案', why: '体现方案取舍' }],
          coachingNote: '建议先讲约束再讲方案。',
          practicePrompt: '可重答一次练习。',
          confidence: 0.74,
        };
      case 'P10':
        return {
          taskCode: 'P10',
          overview: { mode: 'coach', directionCoverage: { covered: 2, planned: 3 }, durationUsedMinutes: 26, completedAnswers: 3, avgScore: 68 },
          dimensionReport: DIMS_SAMPLE,
          highlight: { bestAnswer: { turnRef: 'turn:1', why: '结构清晰' }, improvementStart: { turnRef: 'turn:2', why: '缺边界' } },
          actionPlan: [{ area: '方案取舍', suggestion: '补充约束与失败处理', practiceSuggestion: '用 STAR 结构重答', priority: 'high' }],
          confidence: 0.83,
        };
      default:
        throw new Error(`MockProvider 未实现任务: ${task}`);
    }
  }
}

// 半档（0.5 步进）合法的整场八维评分样本
const DIMS_SAMPLE: { dim: (typeof DIMS)[number]; overallScore: number; trend: 'up' | 'flat' | 'down' }[] =
  DIMS.map((dim, i) => ({
    dim,
    overallScore: [4, 4, 3.5, 3.5, 3, 3, 4, 3][i],
    trend: 'flat',
  }));

/** Mock 语音网关：ASR/TTS 返回占位，保证链路可跑。 */
@Injectable()
export class MockVoiceGateway implements VoiceGateway {
  readonly vendor = 'glm';
  async transcribe({ audioRef }: { audioRef: string }): Promise<{ text: string; confidence: number }> {
    void audioRef;
    return { text: '（Mock 转写）我会记录用户的实际回答。', confidence: 0.9 };
  }
  async synthesize(_: { text: string; voice?: string }): Promise<{ audioRef: string; durationMs: number }> {
    return { audioRef: 'tts://mock', durationMs: 0 };
  }
}