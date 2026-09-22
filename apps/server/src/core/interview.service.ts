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
    if (!questionText) {
      const q = (await this.compose.compose('P06', this.ctx(it, 'P06', { it, phase }))) as MainQuestion;
      questionText = q.questionText;
      topic = q.topic;
      difficulty = q.difficulty;
      targetAspect = q.targetAspect;
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
    this.store.saveInterview(it);
    return turn;
  }

  async answer(input: AnswerInput) {
    const it = this.mustGet(input.interviewId);
    this.assertStatus(it, ['active']);
    const turn = it.turns.find((t) => t.id === input.turnId);
    if (!turn) throw new NotFoundException('作答轮不存在');
    const stage = input.stage ?? 'first';

    // 语音链路：提供 audioRef 时走 ASR 转写；无音频时直接用转录文本。
    let transcript = input.transcript ?? '';
    if (input.audioRef) {
      const asr = await this.voice.transcribe({ audioRef: input.audioRef });
      if (!transcript) transcript = asr.text;
    }
    if (!transcript.trim()) throw new ConflictException('需要转写文本或音频');

    if (it.kind === 'mock') {
      // 模拟：不向用户返回即时评价，但静默评估存档，供「结束后统一复盘」基于真实作答生成整场报告。
      const ev = normalizeEvaluation((await this.compose.compose('P07', this.ctx(it, 'P07', { it, turn, transcript }))) as Evaluation);
      turn.attempts.push({ id: newId('attempt'), stage, transcript, audioRef: input.audioRef, evaluation: ev, createdAt: now() });
      this.store.saveInterview(it);
      return { recorded: true } as const;
    }

    const ev = normalizeEvaluation((await this.compose.compose('P07', this.ctx(it, 'P07', { it, turn, transcript }))) as Evaluation);
    const follow = (await this.compose.compose('P08', this.ctx(it, 'P08', { it, turn, evaluation: ev }))) as FollowUpDecision;
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

  async adjust(id: string, confirm?: boolean): Promise<OutlineAdjustment> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['active']);
    const adj = (await this.compose.compose('P05', this.ctx(it, 'P05', { it }))) as OutlineAdjustment;
    // 模拟模式自动应用；陪练模式仅在用户确认后应用（不因模型 mode=auto 而静默改动大纲）。
    const apply = it.kind === 'mock' || confirm === true;
    if (apply) {
      it.outlineAdjustedAt = now();
      this.store.saveInterview(it);
    }
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
