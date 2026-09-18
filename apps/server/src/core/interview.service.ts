import { Injectable, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import {
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
} from '@ai-interviewer/contracts';
import { ComposeService } from '../ai/compose.service.js';
import { PromptService } from '../admin/prompt.service.js';
import { normalizeEvaluation } from './evaluation.guard.js';
import { InMemoryStore, newId, now, type InterviewRecord, type Turn } from './store.js';

export interface CreateInterviewInput {
  resumeId: string;
  targetRole: string;
  level: 'junior' | 'mid' | 'senior';
  kind?: 'coach' | 'mock';
  durationTier?: '15m' | '30m' | '45m';
}

export interface AnswerInput {
  interviewId: string;
  turnId: string;
  transcript: string;
  stage?: 'first' | 'after_hint';
}

/** 面试状态机 + P01—P10 编排。MVP 直连 ComposeService + 内存仓库。 */
@Injectable()
export class InterviewService {
  constructor(
    @Inject(InMemoryStore) private readonly store: InMemoryStore,
    @Inject(ComposeService) private readonly compose: ComposeService,
    @Inject(PromptService) private readonly prompts: PromptService,
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

  getResume(id: string) {
    const r = this.store.getResume(id);
    if (!r) throw new NotFoundException('简历不存在');
    return r;
  }

  /* ---------- 面试创建与推进 ---------- */

  create(input: CreateInterviewInput): InterviewRecord {
    if (!this.store.getResume(input.resumeId)) throw new NotFoundException('简历不存在');
    const interview: InterviewRecord = {
      id: newId('interview'),
      resumeId: input.resumeId,
      targetRole: input.targetRole,
      level: input.level,
      kind: input.kind ?? 'coach',
      durationTier: input.durationTier ?? '30m',
      directions: [],
      status: 'draft',
      turns: [],
      promptLocks: {},
      createdAt: now(),
      updatedAt: now(),
    };
    return this.store.saveInterview(interview);
  }

  private mustGet(id: string): InterviewRecord {
    const it = this.store.getInterview(id);
    if (!it) throw new NotFoundException('面试不存在');
    return it;
  }
  private assertStatus(it: InterviewRecord, statuses: InterviewRecord['status'][]) {
    if (!statuses.includes(it.status)) throw new ConflictException(`当前状态不允许该操作: ${it.status}`);
  }

  async analyze(id: string): Promise<PositionAnalysis> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['draft']);
    const resume = this.getResume(it.resumeId);
    const position = (await this.compose.compose('P02', { resume: resume.analysis, targetRole: it.targetRole })) as PositionAnalysis;
    it.position = position;
    this.store.saveInterview(it);
    return position;
  }

  async directions(id: string, selected?: string[]): Promise<Directions> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['draft']);
    const result = (await this.compose.compose('P03', { position: it.position, selected })) as Directions;
    it.directionsResult = result;
    it.directions = selected ?? result.recommendedDirections.map((d) => d.id);
    this.store.saveInterview(it);
    return result;
  }

  async outline(id: string): Promise<InterviewOutline> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['draft']);
    const outline = (await this.compose.compose('P04', { it })) as InterviewOutline;
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
    // 开场快照：锁定 P01—P10 当前已发布版本，后续发布不影响本场
    const promptLocks: InterviewRecord['promptLocks'] = {};
    for (const code of TASK_CODES) {
      const pv = this.prompts.getPublishedVersionForTask(code);
      if (pv) promptLocks[code] = { versionId: pv.versionId, versionNo: pv.versionNo };
    }
    it.promptLocks = promptLocks;
    it.status = 'active';
    return this.store.saveInterview(it);
  }

  async newTurn(id: string, phase: InterviewRecord['turns'][number]['phase']): Promise<Turn> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['active']);
    const q = (await this.compose.compose('P06', { it, phase })) as MainQuestion;
    const seqNo = it.turns.filter((t) => t.phase === phase).length + 1;
    const turn: Turn = {
      id: newId('turn'),
      phase,
      seqNo,
      question: q.questionText,
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

    if (it.kind === 'mock') {
      // 模拟：仅记录，不即时反馈
      turn.attempts.push({ id: newId('attempt'), stage, transcript: input.transcript, createdAt: now() });
      this.store.saveInterview(it);
      return { recorded: true } as const;
    }

    const ev = normalizeEvaluation((await this.compose.compose('P07', { it, turn, transcript: input.transcript })) as Evaluation);
    const follow = (await this.compose.compose('P08', { it, turn, evaluation: ev })) as FollowUpDecision;
    turn.attempts.push({ id: newId('attempt'), stage, transcript: input.transcript, evaluation: ev, followUp: follow, createdAt: now() });
    this.store.saveInterview(it);
    return { evaluation: ev, next: follow } as const;
  }

  async adjust(id: string, confirm?: boolean): Promise<OutlineAdjustment> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['active']);
    const adj = (await this.compose.compose('P05', { it })) as OutlineAdjustment;
    if (adj.mode === 'auto' || confirm === true) {
      it.outlineAdjustedAt = now();
      this.store.saveInterview(it);
    }
    return adj;
  }

  async finish(id: string): Promise<SessionReport> {
    const it = this.mustGet(id);
    this.assertStatus(it, ['active']);
    const report = (await this.compose.compose('P10', { it })) as SessionReport;
    it.report = report;
    it.status = 'finished';
    this.store.saveInterview(it);
    return report;
  }

  get(id: string): InterviewRecord {
    return this.mustGet(id);
  }
  list() {
    return this.store.listInterviews();
  }
}