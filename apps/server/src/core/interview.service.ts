import { Injectable, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import {
  Coaching,
  Directions,
  Evaluation,
  FollowUpDecision,
  InterviewOutline,
  MainQuestion,
  OutlineAdjustment,
  PositionAnalysis,
  ResumeUnderstanding,
  SessionReport,
  TASK_CODES,
  type TaskCode,
} from '@ai-interviewer/contracts';
import { ComposeService } from '../ai/compose.service.js';
import { MockVoiceGateway } from '../ai/mock.provider.js';
import { PromptService } from '../admin/prompt.service.js';
import { normalizeEvaluation, normalizeSessionReport } from './evaluation.guard.js';
import { InMemoryStore, newId, now, type InterviewRecord, type Turn } from './store.js';

export interface CreateInterviewInput {
  resumeId: string;
  targetRole: string;
  /** 可选 JD 文本（api-spec 3.1 的 jdText），供岗位分析参考。 */
  jdText?: string;
  /** 面试风格（professional/coaching/concise）。 */
  style?: string;
  level: 'junior' | 'mid' | 'senior';
  kind?: 'coach' | 'mock';
  durationTier?: '15m' | '30m' | '45m';
  keepAudio?: boolean;
}

export interface AnswerInput {
  interviewId: string;
  turnId: string;
  transcript?: string;
  audioRef?: string;
  stage?: 'first' | 'after_hint';
}

export type ModelProgress = { phase: 'requesting' | 'delta' | 'validating' | 'retrying' | 'complete'; message: string };

/** 作答链路的分阶段进度：ASR 转写 + P07 评价 + P08 追问决策，供练习室展示「大模型思考过程」。 */
export type AnswerProgress = ModelProgress & { task: 'ASR' | 'P07' | 'P08' };

/**
 * 自我介绍环节的引导问题。业务逻辑：面试开场固定为自我介绍，故不依赖模型生成，
 * 避免进阶技术题混入 intro 阶段（与当前环节标签不一致）。
 */
const INTRO_TOPIC = '自我介绍';
const INTRO_QUESTIONS = [
  '请先用 1-2 分钟做一个自我介绍，重点介绍你最拿手、最能体现深度的一个项目。',
  '简单介绍一下你的技术背景，以及这段经历中最让你有成就感的一件事。',
  '先做个简短自我介绍，然后说说你目前最希望提升的一个方面。',
];

/** 面试状态机 + P01—P10 编排。MVP 直连 ComposeService + 内存仓库。 */
@Injectable()
export class InterviewService {
  constructor(
    @Inject(InMemoryStore) private readonly store: InMemoryStore,
    @Inject(ComposeService) private readonly compose: ComposeService,
    @Inject(PromptService) private readonly prompts: PromptService,
    @Inject(MockVoiceGateway) private readonly voice: MockVoiceGateway,
  ) {}

  /* ---------- 简历 ---------- */

  async parseResume(text: string, title: string) {
    const analysis = (await this.compose.compose('P01', { text })) as ResumeUnderstanding;
    const resume = this.store.saveResume({
      id: newId('resume'),
      title,
      text,
      status: 'parsed',
      analysis,
      createdAt: now(),
    });
    return resume;
  }

  async parseResumeWithProgress(
    text: string,
    title: string,
    onProgress: (event: { phase: 'requesting' | 'delta' | 'validating' | 'retrying' | 'complete'; message: string }) => void,
  ) {
    const analysis = (await this.compose.composeWithProgress('P01', { text }, onProgress)) as ResumeUnderstanding;
    const resume = this.store.saveResume({
      id: newId('resume'),
      title,
      text,
      status: 'parsed',
      analysis,
      createdAt: now(),
    });
    return resume;
  }

  getResume(id: string) {
    const r = this.store.getResume(id);
    if (!r) throw new NotFoundException('简历不存在');
    return r;
  }

  listResumes() {
    return this.store.listResumes();
  }

  removeResume(id: string): void {
    this.getResume(id);
    if (this.store.listInterviews().some((interview) => interview.resumeId === id)) {
      throw new ConflictException('该简历已有面试记录，暂不能删除');
    }
    this.store.deleteResume(id);
  }

  renameResume(id: string, title: string) {
    const resume = this.getResume(id);
    resume.title = title;
    return this.store.saveResume(resume);
  }

  /* ---------- 面试创建与推进 ---------- */

  create(input: CreateInterviewInput): InterviewRecord {
    if (!this.store.getResume(input.resumeId)) throw new NotFoundException('简历不存在');
    this.sweepOrphanAudio();
    const interview: InterviewRecord = {
      id: newId('interview'),
      resumeId: input.resumeId,
      targetRole: input.targetRole,
      jdText: input.jdText,
      style: input.style,
      level: input.level,
      kind: input.kind ?? 'coach',
      durationTier: input.durationTier ?? '30m',
      keepAudio: input.keepAudio,
      directions: [],
      status: 'draft',
      turns: [],
      promptLocks: {},
      createdAt: now(),
      updatedAt: now(),
    };
    return this.store.saveInterview(interview);
  }

  /** 清理未被任何面试轮次引用的孤立录音（上传后未作答/作答失败残留），防止内存泄漏。 */
  private sweepOrphanAudio(): number {
    const referenced = new Set<string>();
    for (const it of this.store.listInterviews()) {
      for (const t of it.turns) {
        for (const a of t.attempts) {
          if (a.audioRef) referenced.add(a.audioRef);
        }
      }
    }
    let removed = 0;
    for (const ref of this.store.listAudioRefs()) {
      if (!referenced.has(ref) && this.store.deleteAudio(ref)) removed++;
    }
    return removed;
  }

  private mustGet(id: string): InterviewRecord {
    const it = this.store.getInterview(id);
    if (!it) throw new NotFoundException('面试不存在');
    return it;
  }

  /** 取本场锁定的任务版本内容（无锁定则用默认提示词的落点由 provider 决定）。 */
  private lockedPrompt(it: InterviewRecord, task: TaskCode): string | undefined {
    const lock = it.promptLocks[task];
    if (!lock) return undefined;
    return this.prompts.getVersion(lock.versionId)?.content;
  }

  /** 组装 compose 上下文；若该场锁定过该任务版本，则附上 promptTemplate 供 provider 使用。 */
  private ctx(it: InterviewRecord, task: TaskCode, extra: Record<string, unknown>): Record<string, unknown> {
    const promptTemplate = this.lockedPrompt(it, task);
    return promptTemplate ? { ...extra, promptTemplate } : extra;
  }
  private assertStatus(it: InterviewRecord, statuses: InterviewRecord['status'][]) {
    if (!statuses.includes(it.status)) throw new ConflictException(`当前状态不允许该操作: ${it.status}`);
  }

  async analyze(id: string, onProgress?: (event: ModelProgress) => void): Promise<PositionAnalysis> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['draft']);
    // 中断后继续准备时复用已持久化的岗位分析，不重复调用模型。
    if (it.position) return it.position as PositionAnalysis;
    const resume = this.getResume(it.resumeId);
    const context = this.ctx(it, 'P02', { resume: resume.analysis, targetRole: it.targetRole, jdText: it.jdText });
    const position = (await (onProgress ? this.compose.composeWithProgress('P02', context, onProgress) : this.compose.compose('P02', context))) as PositionAnalysis;
    it.position = position;
    this.store.saveInterview(it);
    return position;
  }

  async directions(id: string, selected?: string[], extra?: string, onProgress?: (event: ModelProgress) => void): Promise<Directions> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['draft']);
    if (!it.position) throw new ConflictException('尚未完成岗位分析，无法推荐考察方向');
    // 初次计划流重连时复用 P03；用户调整方向或补充诉求后才重新生成。
    if (selected === undefined && extra === undefined && it.directionsResult) return it.directionsResult as Directions;
    const context = this.ctx(it, 'P03', { position: it.position, selected, extra });
    const result = (await (onProgress ? this.compose.composeWithProgress('P03', context, onProgress) : this.compose.compose('P03', context))) as Directions;
    it.directionsResult = result;
    it.directions = selected ?? result.recommendedDirections.map((d) => d.id);
    this.store.saveInterview(it);
    return result;
  }

  async outline(id: string, onProgress?: (event: ModelProgress) => void): Promise<InterviewOutline> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['draft']);
    if (!it.directionsResult) throw new ConflictException('尚未完成考察方向推荐，无法生成大纲');
    const context = this.ctx(it, 'P04', { it });
    const outline = (await (onProgress ? this.compose.composeWithProgress('P04', context, onProgress) : this.compose.compose('P04', context))) as InterviewOutline;
    const budget = outline.durationPlan.budgetMinutes;
    const used = outline.durationPlan.phases.reduce((s, p) => s + p.minutes, 0);
    if (used > budget) throw new ConflictException(`大纲时长超预算: ${used}/${budget}`);
    it.outline = outline;
    this.store.saveInterview(it);
    return outline;
  }

  start(id: string): InterviewRecord {
    const it = this.mustGet(id);
    this.assertStatus(it, ['draft', 'active']);
    // 业务守卫：未生成大纲不允许开考（避免空场次）。
    if (!it.outline) throw new ConflictException('尚未生成面试大纲，无法开始');
    // 开场快照：锁定 P01—P10 当前已发布版本，后续发布不影响本场
    const promptLocks: InterviewRecord['promptLocks'] = {};
    for (const code of TASK_CODES) {
      const pv = this.prompts.getPublishedVersionForTask(code);
      if (pv) promptLocks[code] = { versionId: pv.versionId, versionNo: pv.versionNo };
    }
    it.promptLocks = promptLocks;
    it.status = 'active';
    it.startedAt = it.startedAt ?? now();
    return this.store.saveInterview(it);
  }

  async newTurn(id: string, phase: InterviewRecord['turns'][number]['phase'], parentTurnId?: string): Promise<Turn> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['active']);
    const seqNo = it.turns.filter((t) => t.phase === phase).length + 1;

    let questionText: string | undefined;
    let parentId: string | undefined;
    let topic: string | undefined;
    let difficulty: Turn['difficulty'];
    let targetAspect: Turn['targetAspect'];
    if (parentTurnId) {
      // 追问轮：取父轮最后一次作答里 P08 生成的追问文本
      const parent = it.turns.find((t) => t.id === parentTurnId);
      const hint = parent?.attempts[parent.attempts.length - 1]?.followUp as { questions?: { text: string; difficulty?: Turn['difficulty'] }[] } | undefined;
      const q0 = hint?.questions?.[0];
      if (q0?.text) {
        questionText = q0.text;
        parentId = parentTurnId;
        topic = parent?.topic;
        difficulty = q0.difficulty;
      }
    }
    // 自我介绍后确认的分环节延伸追问：仅在新主问题时优先下发，不能覆盖 P08 的指定追问。
    let pendingFollowupIndex: number | undefined;
    if (!parentTurnId && phase !== 'intro' && it.followups?.length) {
      const followupIdx = it.followups.findIndex((f) => f.phase === phase);
      if (followupIdx >= 0) {
        const f = it.followups[followupIdx];
        questionText = f.question;
        topic = '自我介绍延伸';
        difficulty = 'mid';
        targetAspect = ({ keypoint: '要点深挖', deepen: '深度追问', contradiction: '澄清矛盾' } as Record<string, string>)[f.kind ?? 'deepen'] ?? '延伸追问';
        pendingFollowupIndex = followupIdx;
      }
    }
    if (!questionText) {
      if (phase === 'intro') {
        // 环节业务逻辑：开场固定为自我介绍引导（确定性，不依赖模型），保证与环节标签一致。
        questionText = INTRO_QUESTIONS[(seqNo - 1) % INTRO_QUESTIONS.length];
        topic = INTRO_TOPIC;
        difficulty = 'begin';
        targetAspect = '表达与结构';
      } else {
        const q = (await this.compose.compose('P06', this.ctx(it, 'P06', { it, phase }))) as MainQuestion;
        questionText = q.questionText;
        topic = q.topic;
        difficulty = q.difficulty;
        targetAspect = q.targetAspect;
      }
    }
    const audio = await this.voice.synthesize({ text: questionText });
    const turn: Turn = {
      id: newId('turn'),
      phase,
      seqNo,
      question: questionText,
      topic,
      difficulty,
      targetAspect,
      parentTurnId: parentId,
      ttsRef: audio.audioRef,
      attempts: [],
      createdAt: now(),
    };
    it.turns.push(turn);
    // 语音合成成功、题目真正写入本场后才消费队列，避免失败重试时丢失已确认的问题。
    if (pendingFollowupIndex !== undefined) it.followups?.splice(pendingFollowupIndex, 1);
    this.store.saveInterview(it);
    return turn;
  }

  async answer(input: AnswerInput, onProgress?: (event: AnswerProgress) => void) {
    const it = this.mustGet(input.interviewId);
    this.assertStatus(it, ['active']);
    const turn = it.turns.find((t) => t.id === input.turnId);
    if (!turn) throw new NotFoundException('作答轮不存在');
    const stage = input.stage ?? 'first';
    // 三个阶段各自打上 task 标签，前端据此区分「转写 / 评价 / 追问」来源。
    const asrProgress = (event: ModelProgress) => onProgress?.({ ...event, task: 'ASR' });
    const p07Progress = (event: ModelProgress) => onProgress?.({ ...event, task: 'P07' });
    const p08Progress = (event: ModelProgress) => onProgress?.({ ...event, task: 'P08' });

    // 语音链路：提供 audioRef 时走 ASR 转写；无音频时直接用转录文本。
    let transcript = input.transcript ?? '';
    if (input.audioRef) {
      asrProgress({ phase: 'requesting', message: '正在把录音转写为文本…' });
      const asr = await this.voice.transcribe({ audioRef: input.audioRef });
      if (!transcript) transcript = asr.text;
      asrProgress({ phase: 'complete', message: `语音转写完成（${transcript.length} 字）。` });
    }
    if (!transcript.trim()) throw new ConflictException('需要转写文本或音频');

    const p07Context = this.ctx(it, 'P07', { it, turn, transcript });
    const evaluate = () => (onProgress
      ? this.compose.composeWithProgress('P07', p07Context, p07Progress)
      : this.compose.compose('P07', p07Context));

    if (it.kind === 'mock') {
      // 模拟：不向用户返回即时评价，但静默评估存档，供「结束后统一复盘」基于真实作答生成整场报告。
      const ev = normalizeEvaluation((await evaluate()) as Evaluation);
      turn.attempts.push({ id: newId('attempt'), stage, transcript, audioRef: input.audioRef, evaluation: ev, createdAt: now() });
      this.store.saveInterview(it);
      return { recorded: true } as const;
    }

    const ev = normalizeEvaluation((await evaluate()) as Evaluation);
    const followContext = this.ctx(it, 'P08', { it, turn, evaluation: ev });
    const follow = (await (onProgress
      ? this.compose.composeWithProgress('P08', followContext, p08Progress)
      : this.compose.compose('P08', followContext))) as FollowUpDecision;
    turn.attempts.push({ id: newId('attempt'), stage, transcript, audioRef: input.audioRef, evaluation: ev, followUp: follow, createdAt: now() });
    this.store.saveInterview(it);
    return { evaluation: ev, next: follow, transcript } as const;
  }

  /** 单轮辅导优化（P09）：基于末次作答生成更高分示范与改进建议。 */
  async coach(id: string, turnId: string): Promise<Coaching> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['active']);
    const turn = it.turns.find((t) => t.id === turnId);
    if (!turn) throw new NotFoundException('作答轮不存在');
    const last = turn.attempts[turn.attempts.length - 1];
    if (!last) throw new ConflictException('该轮尚未作答');
    const transcript = last.transcript;
    return (await this.compose.compose('P09', this.ctx(it, 'P09', { it, turn, transcript }))) as Coaching;
  }

  async adjust(id: string, action: 'preview' | 'apply' | 'discard' = 'preview'): Promise<OutlineAdjustment | undefined> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['active']);
    const introCompleted = it.turns.some((turn) => turn.phase === 'intro' && turn.attempts.length > 0);
    if (!introCompleted) throw new ConflictException('完成自我介绍后才能调整后续大纲');
    if (action === 'discard') {
      if (it.pendingAdjustment) {
        delete it.pendingAdjustment;
        this.store.saveInterview(it);
      }
      return undefined;
    }
    if (it.outlineAdjustedAt) throw new ConflictException('自我介绍后的大纲已调整，不能重复应用');

    // 陪练先持久化预览，用户确认时必定应用同一份结果，避免“看到 A、实际应用 B”。
    const adj = it.pendingAdjustment ?? ((await this.compose.compose('P05', this.ctx(it, 'P05', { it }))) as OutlineAdjustment);
    if (action === 'preview') {
      if (!it.pendingAdjustment) {
        it.pendingAdjustment = adj;
        this.store.saveInterview(it);
      }
      return adj;
    }

    it.outlineAdjustedAt = now();
    it.followups = (adj.followups ?? []).map((f) => ({ id: newId('followup'), phase: f.phase, question: f.question, reason: f.reason, kind: f.kind }));
    delete it.pendingAdjustment;
    this.store.saveInterview(it);
    return adj;
  }

  async finish(id: string): Promise<SessionReport> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['active']);
    let report = (await this.compose.compose('P10', this.ctx(it, 'P10', { it }))) as SessionReport;
    // 整场报告与逐题八维实测对齐（教练模式有 P07 数据时重算聚合值）。
    report = normalizeSessionReport(report, it.turns);
    it.report = report;
    it.status = 'finished';
    this.store.saveInterview(it);
    // 录音保留策略：默认会话结束即删；用户显式选择 keepAudio 才保留。
    if (!it.keepAudio) this.deleteSessionAudio(it);
    return report;
  }

  /** 清理本场全部录音引用（按 ui 保留策略使用；keepAudio 时跳过）。 */
  private deleteSessionAudio(it: InterviewRecord): void {
    for (const t of it.turns) {
      for (const a of t.attempts) {
        if (a.audioRef) this.store.deleteAudio(a.audioRef);
      }
    }
  }

  get(id: string): InterviewRecord {
    return this.mustGet(id);
  }
  /** 删除一场面试记录（任意状态）。删除即弃：无论保留偏好如何，录音一并清理（记录都没了，音频无主）。 */
  remove(id: string): boolean {
    const it = this.mustGet(id);
    this.deleteSessionAudio(it);
    if (!this.store.deleteInterview(id)) throw new NotFoundException('面试不存在');
    return true;
  }
  list() {
    // 列表仅返回摘要视图，不外送 turns（含转写/评价等敏感数据）；附带进行中场次的当前环节供预览。
    return this.store.listInterviews().map((it) => ({
      id: it.id,
      kind: it.kind,
      level: it.level,
      status: it.status,
      targetRole: it.targetRole,
      durationTier: it.durationTier,
      updatedAt: it.updatedAt,
      currentPhase: it.status === 'active' ? it.turns[it.turns.length - 1]?.phase : undefined,
      report: it.report,
    }));
  }
}
