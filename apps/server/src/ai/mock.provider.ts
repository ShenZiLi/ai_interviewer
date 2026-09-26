import { Injectable } from '@nestjs/common';
import { buildDims, DIMS, gradeOf, overallScore, WEIGHTS, toDisplay } from '@ai-interviewer/contracts';
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
      case 'P04': {
        // 按所选方向挑选大纲主问题（未选/全选时回落到 tech 题库），使流程与用户选择一致。
        const selected = ((context as { it?: P04Ctx })?.it?.directions) ?? [];
        const pool = QUESTIONS_BY_PHASE.tech.filter((q) => !q.biasToDirections?.length || q.biasToDirections.some((d) => selected.includes(d)));
        const use = pool.length ? pool : QUESTIONS_BY_PHASE.tech;
        const outline = use.slice(0, 3).map((q) => ({ topic: q.topic, mainQuestion: q.text, difficulty: q.difficulty, followUpPlan: { depth: 3, branches: ['前提条件', '失败处理'] } }));
        const focus = [...new Set(use.slice(0, 3).map((q) => q.topic))];
        return {
          summary: '围绕所选方向展开 30 分钟标准面试。',
          durationPlan: { tier: '30m', budgetMinutes: 30, phases: [{ phase: 'tech', minutes: 18, questionCount: Math.max(1, outline.length), focus }, { phase: 'biz', minutes: 8, questionCount: 1, focus: ['项目取舍'] }, { phase: 'hr', minutes: 4, questionCount: 1, focus: ['离职原因'] }] },
          outline,
          coveredDirections: use.slice(0, 3).flatMap((q) => q.biasToDirections ?? []).filter((d, i, a) => a.indexOf(d) === i),
          confidence: 0.8,
        };
      }
      case 'P05':
        return {
          changes: [{ type: 'add', ref: 'project_orders', after: '新增幂等设计追问', reason: '自我介绍提及重复下单处理' }],
          newlyNoted: [{ fact: '熟悉 Kafka', appliedTo: 'tech' }],
          // 依据自我介绍的要点/矛盾点按需生成的延伸追问（可空；仅对值得追问的环节出题）。
          followups: [
            { phase: 'tech', question: '你提到主导过库存扣减改造，若并发翻十倍，你会怎么保证不超卖？', reason: '要点：库存扣减为自我介绍亮点', kind: 'keypoint' },
            { phase: 'biz', question: '支付成功率提升这类指标，你如何区分技术优化与业务容忍带来的贡献？', reason: '可追问点：指标提升归因含混', kind: 'deepen' },
          ],
          mode: 'auto',
          confidence: 0.85,
        };
      case 'P06': {
        // 按阶段 + 同阶段序号出题，让 mock 演示的主问题随流程推进变化（避免全场同一题）。
        const { it, phase } = (context ?? {}) as { it?: P06Ctx; phase?: string };
        const seq = (it?.turns ?? []).filter((t) => t.phase === phase).length + 1;
        const bank = QUESTIONS_BY_PHASE[phase as keyof typeof QUESTIONS_BY_PHASE] ?? QUESTIONS_BY_PHASE.tech;
        const q = bank[(seq - 1) % bank.length];
        return {
          questionText: q.text,
          topic: q.topic,
          difficulty: q.difficulty,
          targetAspect: q.targetAspect,
          probePoints: q.probePoints,
          biasToDirections: q.biasToDirections,
          contextUsed: ['简历项目：库存扣减'],
          confidence: 0.86,
        };
      }
      case 'P07': {
        // 按作答内容做确定性扰动，让每个维度的分随文本轻微变化（跨会话自然分化，
        // 使复盘「vs 上一场」趋势默认可见）；同文本恒确定。
        const seed = seedOf((context as { transcript?: string })?.transcript);
        const vals = [3, 4, 3.5, 3, 3, 4, 4, 4].map((v, i) =>
          Math.min(4.5, Math.max(2.5, v + ((seed >> i) & 1 ? 0.5 : -0.5))),
        );
        const score = overallScore(vals);
        // 面试风格只影响反馈文案口径（评分/量表不变），使风格选项在 mock 下可见且确定性。
        const style = styleOf(context);
        const wording = style === 'concise'
          ? { overall: '切题但深度不足。', coachingNote: '先讲约束，再给方案。', suggestionBody: '补上部署边界与失败处理。' }
          : style === 'coaching'
            ? { overall: '整体思路不错，可以从部署边界切入再展开，把前提说清。', coachingNote: '从你熟悉的场景切入，再抽象成一般结论。', suggestionBody: '先说明多实例，再比较分布式锁与数据库条件更新。' }
            : { overall: '切题但深度不足，未说清多实例边界。', coachingNote: '建议先讲约束再讲方案。', suggestionBody: '先说明多实例，再比较分布式锁与数据库条件更新。' };
        return {
          taskCode: 'P07',
          overall: wording.overall,
          grade: gradeOf(score),
          score,
          dims: buildDims(vals).map((d) => ({ ...d, evidence: ['引用回答片段'] })),
          strengths: ['先识别了问题并给出思路'],
          weaknesses: ['缺少适用前提与失败处理'],
          suggestions: [{ title: '补充部署边界', body: wording.suggestionBody }],
          misconceptions: [{ quote: '本地锁能覆盖多实例', clarification: '本地锁仅单进程内有效', kind: 'knowledge' }],
          followUpHint: { recommended: true, reason: '可追问边界条件' },
          confidence: 0.79,
          flags: [],
        };
      }
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
          coachingNote: styleOf(context) === 'concise' ? '先讲约束，再给方案。' : styleOf(context) === 'coaching' ? '从你熟悉的场景切入，再抽象成一般结论。' : '建议先讲约束再讲方案。',
          practicePrompt: '可重答一次练习。',
          confidence: 0.74,
        };
      case 'P10': {
        // 教练模式：整场报告以本轮实测八维（P07）为准聚合，保证与逐题成绩自洽；
        // 模拟模式 / 无作答（无实测数据）时回退固定样本。
        const it = (context as { it?: P10Context })?.it;
        const mode = it?.kind === 'mock' ? 'mock' : 'coach';
        const measurements = collectMeasurements(it);
        if (!measurements.length) {
          return {
            taskCode: 'P10',
            overview: { mode, directionCoverage: { covered: 2, planned: 3 }, durationUsedMinutes: 26, completedAnswers: 0, avgScore: 68 },
            dimensionReport: DIMS_SAMPLE,
            highlight: { bestAnswer: { turnRef: 'turn:1', why: '结构清晰' }, improvementStart: { turnRef: 'turn:2', why: '缺边界' } },
            actionPlan: [{ area: '方案取舍', suggestion: '补充约束与失败处理', practiceSuggestion: '用 STAR 结构重答', priority: 'high' }],
            confidence: 0.83,
          };
        }
        const perDim = DIMS.map((dim) => {
          const vals = measurements.map((m) => m[dim]).filter((n): n is number => typeof n === 'number');
          if (!vals.length) return null;
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          return Math.round(avg * 2) / 2; // 收敛到 0.5 步进
        });
        if (perDim.some((s) => s === null)) {
          return {
            taskCode: 'P10',
            overview: { mode, directionCoverage: { covered: 2, planned: 3 }, durationUsedMinutes: 26, completedAnswers: measurements.length, avgScore: 68 },
            dimensionReport: DIMS_SAMPLE,
            highlight: { bestAnswer: { turnRef: 'turn:1', why: '结构清晰' }, improvementStart: { turnRef: 'turn:2', why: '缺边界' } },
            actionPlan: [{ area: '方案取舍', suggestion: '补充约束与失败处理', practiceSuggestion: '用 STAR 结构重答', priority: 'high' }],
            confidence: 0.83,
          };
        }
        const scores = perDim as number[];
        let sum = 0;
        DIMS.forEach((dim, i) => { sum += WEIGHTS[dim] * scores[i]!; });
        const avgScore = Math.round(sum * 20);
        const planned = it?.outline?.outline?.length ?? 3;
        // 方向覆盖以「已作答轮的去重主题」计，而非作答数（同一主题多轮只算一次）。
        const answeredTopics = new Set<string>();
        for (const t of it?.turns ?? []) {
          const attempts = t.attempts ?? [];
          const last = attempts[attempts.length - 1];
          if (last && last.evaluation) answeredTopics.add(t.topic ?? '');
        }
        answeredTopics.delete('');
        const covered = Math.min(answeredTopics.size, planned);
        const durationUsedMinutes = (() => {
        // 实际用时 = 开考至今（有 had startedAt），否则退回档位估算。
        const budget = { '15m': 15, '30m': 30, '45m': 45 }[it?.durationTier ?? '30m'] ?? 30;
        if (it?.startedAt) {
          const elapsed = Math.max(1, Math.round((Date.now() - new Date(it.startedAt).getTime()) / 60000));
          return Math.min(elapsed, budget);
        }
        return Math.round(budget * 0.87); // 无起始时间时按档位约 87% 估算
      })();
        const hl = pickHighlights(it);
        return {
          taskCode: 'P10',
          overview: { mode, directionCoverage: { covered, planned }, durationUsedMinutes, completedAnswers: measurements.length, avgScore },
          dimensionReport: DIMS.map((dim, i) => ({ dim, overallScore: scores[i]!, trend: 'flat' })),
          highlight: hl
            ? { bestAnswer: hl.best, improvementStart: hl.worst }
            : { bestAnswer: { turnRef: 'turn:1', why: '整体结构清晰' }, improvementStart: { turnRef: 'turn:1', why: '可补充前提与失败处理' } },
          actionPlan: lowestDimActions(scores),
          confidence: 0.83,
        };
      }
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

/** P06 需要的面试上下文子集（阶段 + 已有轮次，用于按阶段/序号出题）。 */
interface P06Ctx {
  phase?: string;
  turns?: { phase?: string }[];
}

/** P04 需要的面试上下文子集（所选方向 id 列表，用于按选择生成大纲）。 */
interface P04Ctx {
  directions?: string[];
}

interface MockQuestion {
  text: string;
  topic: string;
  difficulty: 'begin' | 'mid' | 'deep';
  targetAspect: string;
  probePoints?: { purpose: string; hint?: string }[];
  biasToDirections?: string[];
}

/** 按阶段准备的 mock 主问题池（与 P04 大纲主题呼应），同阶段序号轮转取题。 */
const QUESTIONS_BY_PHASE: Record<string, MockQuestion[]> = {
  intro: [
    { text: '先用 1-2 分钟做个自我介绍，重点讲你最拿手的项目。', topic: '自我介绍', difficulty: 'begin', targetAspect: '表达与结构' },
    { text: '简单说说你上一段经历中最大的成长。', topic: '成长复盘', difficulty: 'begin', targetAspect: '沟通与反思' },
  ],
  tech: [
    { text: '在线购物结算如何保证不超卖？', topic: '并发控制', difficulty: 'mid', targetAspect: '方案取舍', probePoints: [{ purpose: '考察部署边界', hint: '多实例时本地锁是否有效' }], biasToDirections: ['concurrency'] },
    { text: '跨服务扣库存与下单如何保证一致？', topic: '分布式事务', difficulty: 'deep', targetAspect: '分析与推理', probePoints: [{ purpose: '考察方案深度', hint: '本地消息表与 TCC 的取舍' }], biasToDirections: ['distributed'] },
    { text: '缓存与数据库的一致性如何保证？', topic: '缓存一致性', difficulty: 'mid', targetAspect: '证据与一致性', probePoints: [{ purpose: '考察一致性取舍', hint: '旁路缓存 / 双写' }], biasToDirections: ['cacheredis'] },
  ],
  biz: [
    { text: '介绍一个你主导过的项目：背景、你的取舍与最终结果。', topic: '项目深挖', difficulty: 'mid', targetAspect: '项目深度与贡献' },
    { text: '这个项目如果再给你一次机会，你会改哪个决策？', topic: '取舍复盘', difficulty: 'mid', targetAspect: '方案取舍' },
  ],
  hr: [
    { text: '为什么考虑换工作？未来 3 年的规划是什么？', topic: '职业规划', difficulty: 'begin', targetAspect: '沟通与反思' },
    { text: '你如何理解团队协作中的分歧处理？', topic: '协作', difficulty: 'begin', targetAspect: '沟通与反思' },
  ],
};

/** 从 compose 上下文提取面试风格（professional/coaching/concise），仅影响反馈文案口径。 */
function styleOf(context: unknown): string {
  return ((context as { it?: { style?: string } })?.it?.style) ?? 'professional';
}

/** P10 需要的面试上下文（取 ctx 中完整 it 的一个子集）。 */
interface P10Context {
  kind?: 'coach' | 'mock';
  durationTier?: string;
  startedAt?: string;
  outline?: { outline?: { topic: string; mainQuestion: string }[] };
  turns?: { id?: string; topic?: string; attempts?: { evaluation?: { score?: number; dims?: { dim: string; score: number }[] } }[] }[];
}

/** 依据各轮末次作答的整体分，选出本场最佳与最需改进的轮次（用真实轮 id，供报告高亮）。 */
function pickHighlights(it?: P10Context): { best: { turnRef: string; why: string }; worst: { turnRef: string; why: string } } | undefined {
  let best: { id: string; score: number } | undefined;
  let worst: { id: string; score: number } | undefined;
  for (const t of it?.turns ?? []) {
    const last = t.attempts?.[t.attempts.length - 1];
    const s = last?.evaluation?.score;
    if (typeof s !== 'number' || !t.id) continue;
    if (!best || s > best.score) best = { id: t.id, score: s };
    if (!worst || s < worst.score) worst = { id: t.id, score: s };
  }
  if (!best || !worst) return undefined;
  return {
    best: { turnRef: best.id, why: `本场最高分 ${best.score} 分` },
    worst: { turnRef: worst.id, why: `本场最低分 ${worst.score} 分，优先打磨` },
  };
}

/** 收集各轮末次作答（P07）的八维实测分（0–5）。 */
function collectMeasurements(it?: P10Context): Record<string, number>[] {
  if (!it) return [];
  const out: Record<string, number>[] = [];
  for (const turn of it.turns ?? []) {
    const attempts = turn.attempts ?? [];
    const st = attempts[attempts.length - 1];
    if (!st?.evaluation?.dims) continue;
    const m: Record<string, number> = {};
    for (const d of st.evaluation.dims) m[d.dim] = d.score;
    out.push(m);
  }
  return out;
}

/** 依据八维实测均值生成「下一题专注」行动计划（取最低两维）。 */
function lowestDimActions(scores: number[]): { area: string; suggestion: string; practiceSuggestion: string; priority: 'high' | 'mid' }[] {
  return DIMS.map((_, i) => i)
    .sort((a, b) => scores[a] - scores[b])
    .slice(0, 2)
    .map((i) => {
      const dim = DIMS[i];
      return {
        area: dim,
        suggestion: `「${dim}」本场均值 ${toDisplay(scores[i])} 分，建议用 STAR 结构补足适用前提与失败处理。`,
        practiceSuggestion: `围绕「${dim}」重答一次练习。`,
        priority: scores[i] <= 3 ? 'high' : 'mid',
      };
    });
}

/** 由文本派生一个确定性种子，用于让 Mock P07 的评分随作答内容轻微变化。 */
function seedOf(text?: string): number {
  let h = 0;
  for (const ch of text ?? '') h = (h * 31 + (ch.codePointAt(0) ?? 0)) & 0xffff;
  return h;
}

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