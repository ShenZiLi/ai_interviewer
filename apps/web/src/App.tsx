import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { gradeOf } from '@ai-interviewer/contracts';
import { api, type AnswerResult, type InterviewDetail, type InterviewReport } from './api';
import { buildTrend } from './lib/trend';
import { recentScores } from './lib/session-trend';
import { filterByRole, uniqueRoles } from './lib/session-filter';
import { durLabel } from './lib/durations';

type NavKey = 'home' | 'resume' | 'prepare' | 'room' | 'report' | 'settings' | 'admin';
const titles: Record<NavKey, string> = { home: '工作台', resume: '我的简历', prepare: '准备面试', room: '面试练习室', report: '复盘报告', settings: '设置', admin: '提示词管理' };
const nav: { k: NavKey; icon: string; label: string }[] = [
  { k: 'home', icon: '⌂', label: '工作台' },
  { k: 'resume', icon: '▤', label: '我的简历' },
  { k: 'prepare', icon: '＋', label: '准备面试' },
  { k: 'room', icon: '▥', label: '面试练习室' },
  { k: 'report', icon: '≡', label: '复盘报告' },
  { k: 'settings', icon: '⚙', label: '设置' },
  { k: 'admin', icon: '✎', label: '提示词管理' },
];
const stages = ['自我介绍', '技术问题', '业务问题', 'HR 问题'];
const phaseLabel: Record<string, string> = { intro: '自我介绍', tech: '技术问题', biz: '业务问题', hr: 'HR 问题' };
const PHASES = ['intro', 'tech', 'biz', 'hr'] as const;
type Phase = (typeof PHASES)[number];

interface RoomTurn {
  id: string;
  phase?: Phase;
  question: string;
  topic?: string;
  difficulty?: string;
  targetAspect?: string;
  /** 是否追问轮（不占用本环节主问题计数）。 */
  followup?: boolean;
  /** 首次作答提交（反馈出现）的时间戳，用于统计「反馈阅读 + 重答耗时」。 */
  answeredAt?: number;
  reanswer?: { readMs: number; reanswerMs: number };
  answered?: { recorded?: boolean; transcript: string; score: number; grade: string; overall: string; dims: { dim: string; displayScore?: number }[]; strengths: string[]; weaknesses: string[]; suggestion: string; followup: string[]; misconceptions?: { quote: string; clarification: string; kind?: 'knowledge' | 'asr' | 'assumption' }[] };
}

export function App() {
  const [page, setPage] = useState<NavKey>('home');
  const [text, setText] = useState('三年 Java 后端，负责订单与库存扣减改造，熟悉 Spring Boot、MySQL、Redis、消息队列。');
  const [role, setRole] = useState('Java 后端工程师');
  const [level, setLevel] = useState('中级');
  const [mode, setMode] = useState<'coach' | 'mock'>('coach');
  const [duration, setDuration] = useState<'15m' | '30m' | '45m'>('30m');
  const [keepAudio, setKeepAudio] = useState(false);
  const [resumeId, setResumeId] = useState<string>();
  const [analysis, setAnalysis] = useState<string>();
  const [structured, setStructured] = useState<{ candidateName?: string; skills?: { name: string; level?: string }[]; experiences?: { company: string; role: string; period: string; bullets: string[] }[]; projects?: { name: string; role: string; stack: string[]; points: string[] }[] }>();
  const [interviewId, setInterviewId] = useState<string>();
  const [phase, setPhase] = useState<Phase>('intro');
  const [adjustNote, setAdjustNote] = useState<string>();
  const [dirs, setDirs] = useState<{ id: string; name: string; weight: number; reason?: string }[]>([]);
  const [selectedDirs, setSelectedDirs] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [outlinePhases, setOutlinePhases] = useState<{ phase: string; minutes: number; questionCount: number; focus: string[] }[]>();
  const [outlineQuestions, setOutlineQuestions] = useState<{ topic: string; mainQuestion: string }[]>();
  const [turn, setTurn] = useState<RoomTurn>();
  const [phaseProgress, setPhaseProgress] = useState<Partial<Record<Phase, number>>>({});
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [revising, setRevising] = useState(false);
  const [scoreHistory, setScoreHistory] = useState<{ stage: string; score: number; dims: { dim: string; displayScore?: number }[]; grade?: string }[]>([]);
  const [coaching, setCoaching] = useState<{ summary: string; structure: { point: string; explanation: string }[]; optimization?: { userPoint: string; improved: string; why: string }[]; note?: string; practice?: string }>();
  const [followUpCount, setFollowUpCount] = useState(0);
  const [startedAt, setStartedAt] = useState<string>();
  const [clock, setClock] = useState(Date.now());
  const [report, setReport] = useState<{ avgScore: number; grade: string; completed: number; coverage: string; dims: { dim: string; displayScore?: number }[]; actions: string[] }>();
  const [review, setReview] = useState<{ id: string; parentId?: string; phase: string; question: string; transcript: string; score?: number; grade?: string; attempts: { stage?: string; transcript: string; score?: number; grade?: string }[] }[]>([]);
  const [trend, setTrend] = useState<{ avgDelta: number; dims: { dim: string; delta: number }[] }>();
  const [error, setError] = useState<string>();

  const run = <T,>(p: Promise<T>): Promise<T> => p.catch((e: unknown) => { setError(String((e as Error)?.message ?? e)); throw e; });

  /** 从面试 turns 汇总「回答转写回顾」：逐题保留各次作答（首次/复发并列，不以提示后最高分计入）。 */
  const buildReview = (turns: NonNullable<InterviewDetail['turns']>) =>
    turns
      .filter((t) => t.attempts.length > 0)
      .map((t) => {
        const attempts = t.attempts.map((a) => ({ stage: a.stage, transcript: a.transcript, score: a.evaluation?.score, grade: a.evaluation?.grade }));
        const last = attempts[attempts.length - 1];
        return { id: t.id, parentId: t.parentTurnId, phase: t.phase, question: t.question, attempts, transcript: last.transcript, score: last.score, grade: last.grade };
      });

  /** 抓取本场之前最近一场已完成面试的报告（用于横向对比；无上一场则返回 undefined）。 */
  const fetchPrevReport = async (curId: string): Promise<InterviewReport | undefined> => {
    const items = (await api.listInterviews()).items;
    const prev = items
      .filter((h) => h.status === 'finished' && h.report && h.id !== curId)
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return prev[0]?.report;
  };

  const parseResume = useMutation({
    mutationFn: async () => {
      const r = await run(api.createResume(text));
      setResumeId(r.resume.id);
      setAnalysis(r.resume.analysis.summary);
      setStructured(r.resume.analysis);
      // 换新简历 → 清零与本场/上一场相关的会话状态，避免方向/阶段透传。
      setInterviewId(undefined);
      setPhase('intro');
      setTurn(undefined);
      setPhaseProgress({});
      setReport(undefined);
      setTrend(undefined);
      setReview([]);
      setCoaching(undefined);
      setTopics([]);
      setOutlinePhases(undefined);
      setOutlineQuestions(undefined);
      setSelectedDirs([]);
      setDirs([]);
      setAdjustNote(undefined);
      setStartedAt(undefined);
      // 停留本页供用户确认/修正，再由「确认分析」进入准备。
    },
  });

  const pickResumeFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const supported = f.name.endsWith('.md') || f.name.endsWith('.txt') || f.type === 'text/plain';
    if (!supported) {
      setError('MVP 支持粘贴文本或 .md/.txt 文件；其余格式请改为粘贴文本。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.readAsText(f);
  };

  const bootstrap = useMutation({
    mutationFn: async () => {
      if (!resumeId) throw new Error('请先导入简历');
      const interview = await run(api.createInterview(resumeId, mode, keepAudio));
      await run(api.analyze(interview.interview.id));
      const d = await run(api.directions(interview.interview.id));
      setDirs(d.recommendedDirections.recommendedDirections);
      setSelectedDirs(d.recommendedDirections.recommendedDirections.map((x) => x.id));
      setInterviewId(interview.interview.id);
      setError(undefined);
    },
  });

  /** 按已选方向重新推荐 + 生成大纲 + 开考（此前只管解析/推荐方向）。 */
  const generatePlan = useMutation({
    mutationFn: async () => {
      const d = await run(api.directions(interviewId!, selectedDirs.length ? selectedDirs : undefined));
      setDirs(d.recommendedDirections.recommendedDirections);
      const o = await run(api.outline(interviewId!));
      setTopics(o.outline.outline.map((q) => q.topic));
      setOutlinePhases(o.outline.durationPlan?.phases);
      setOutlineQuestions(o.outline.outline);
      const st = await run(api.start(interviewId!));
      setStartedAt(st.interview.startedAt);
      setError(undefined);
    },
  });

  const beginTurn = useMutation({
    mutationFn: async () => {
      const res = await run(api.newTurn(interviewId!, phase));
      setDraft('');
      setScoreHistory([]);
      setCoaching(undefined);
      setRevising(false);
      reanswerStartRef.current = undefined;
      setRecording(false);
      setFollowUpCount(0);
      setTurn({ id: res.turn.id, question: res.turn.question, phase: res.turn.phase as Phase, topic: res.turn.topic, difficulty: res.turn.difficulty, targetAspect: res.turn.targetAspect, followup: false });
      setPage('room');
    },
  });

  /** 追问：以当前轮为父轮，服务端取 P08 追问文本生成追问轮。 */
  const askFollowUp = useMutation({
    mutationFn: async () => {
      const res = await run(api.newTurn(interviewId!, phase, turn!.id));
      setDraft('');
      setScoreHistory([]);
      setCoaching(undefined);
      setRevising(false);
      reanswerStartRef.current = undefined;
      setRecording(false);
      setFollowUpCount((c) => c + 1);
      setTurn({ id: res.turn.id, question: res.turn.question, phase: res.turn.phase as Phase, topic: res.turn.topic, difficulty: res.turn.difficulty, targetAspect: res.turn.targetAspect, followup: true });
    },
  });

  /** 本环节计划题数（来自大纲；无计划时不提示）。 */
  const plannedOf = (p: Phase) => outlinePhases?.find((x) => x.phase === p)?.questionCount;

  /** 结束面试：本环节未答满计划题数时先确认，避免误提交过早报告。 */
  const goFinish = () => {
    const planned = plannedOf(phase);
    const done = phaseProgress[phase] ?? 0;
    if (planned && done < planned && !window.confirm(`本环节计划 ${planned} 题，目前已答 ${done}。确定结束面试生成报告吗？`)) return;
    finish.mutate();
  };

  /** 答完一题向前推进环节；自我介绍结束自动触发大纲调整(P05)。 */
  const advance = () => {
    const planned = plannedOf(phase);
    const done = phaseProgress[phase] ?? 0;
    if (planned && done < planned && !window.confirm(`本环节计划 ${planned} 题，目前已答 ${done}。确定进入下一环节吗？`)) return;
    const idx = PHASES.indexOf(phase);
    if (phase === 'intro') {
      setAdjustNote('自我介绍后：已按新线索自动更新后续大纲。');
      api.adjustOutline(interviewId!, true).catch(() => setAdjustNote('自我介绍后：大纲自动更新（可选）。'));
    }
    const next = PHASES[idx + 1];
    if (!next) { goFinish(); return; }
    setPhase(next);
    beginTurn.mutate();
  };

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /** 点击「重新回答」的时刻，用于统计反馈阅读 / 重答耗时。 */
  const reanswerStartRef = useRef<number | undefined>(undefined);

  const startRec = async () => {
    setRecording(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持录音，已切换为文本作答');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.start();
      mediaRef.current = rec;
    } catch {
      setError('无法获取麦克风权限，已切换为文本作答');
    }
  };

  /** 首次与复发各次作答的按阶段评分记录（用于陪练并列对比，不以提示后最高分计入统计）。 */
  const compareDims = (() => {
    if (scoreHistory.length < 2) return [];
    const a = scoreHistory[0];
    const b = scoreHistory[scoreHistory.length - 1];
    const keys = new Set<string>();
    a.dims.forEach((d) => keys.add(d.dim));
    b.dims.forEach((d) => keys.add(d.dim));
    return [...keys].map((dim) => ({
      dim,
      a: a.dims.find((d) => d.dim === dim)?.displayScore,
      b: b.dims.find((d) => d.dim === dim)?.displayScore,
    }));
  })();

  const submitAnswer = useMutation({
    mutationFn: async (payload: { transcript?: string; audioRef?: string; stage?: 'first' | 'after_hint' }) => {
      setRecording(false);
      mediaRef.current = null;
      const stage = payload.stage ?? (revising ? 'after_hint' : 'first');
      const transcript = payload.transcript ?? draft;
      const answered = await run(api.answer(interviewId!, turn!.id, payload.audioRef ? { audioRef: payload.audioRef, stage } : { transcript, stage }));
      setScoreHistory((h) => {
        if ('recorded' in answered && answered.recorded) return [...h, { stage, score: 0, dims: [] }];
        const coach = answered as Extract<AnswerResult, { evaluation: { score: number } }>;
        return [...h, { stage, score: coach.evaluation.score, dims: coach.evaluation.dims, grade: coach.evaluation.grade }];
      });
      setRevising(false);
      // 计时：首次作答记录反馈出现时间；重答时按「读到反馈→重答提交」分段。
      const now = Date.now();
      const answeredAt = turn?.answeredAt ?? now;
      let reanswer: RoomTurn['reanswer'];
      if (stage === 'after_hint') {
        const start = reanswerStartRef.current ?? answeredAt;
        reanswer = { readMs: Math.max(0, start - answeredAt), reanswerMs: Math.max(0, now - start) };
        reanswerStartRef.current = undefined;
      }
      const patch = { answeredAt, ...(reanswer ? { reanswer } : {}) };
      // 主问题首次作答计入本环节进度（追问轮与重答不计）。
      if (!turn?.followup && stage === 'first' && turn?.phase) {
        setPhaseProgress((p) => ({ ...p, [turn.phase!]: (p[turn.phase!] ?? 0) + 1 }));
      }
      if ('recorded' in answered && answered.recorded) {
        setTurn({
          ...turn!,
          ...patch,
          answered: {
            recorded: true,
            transcript: transcript || '(音频作答)',
            score: 0,
            grade: '—',
            overall: '模拟模式：本场仅记录回答，整场结束后统一评价。',
            dims: [], strengths: [], weaknesses: [], suggestion: '', followup: [],
          },
        });
        return;
      }
      const coach = answered as Extract<AnswerResult, { evaluation: { score: number } }>;
      setTurn({
        ...turn!,
        ...patch,
        answered: {
          transcript: coach.transcript || transcript || '(音频作答)',
          score: coach.evaluation.score,
          grade: coach.evaluation.grade,
          overall: coach.evaluation.overall,
          dims: coach.evaluation.dims,
          strengths: coach.evaluation.strengths ?? [],
          weaknesses: coach.evaluation.weaknesses ?? [],
          suggestion: coach.evaluation.suggestions?.[0]?.body ?? '',
          followup: coach.next.questions.map((q) => q.text),
          misconceptions: coach.evaluation.misconceptions,
        },
      });
    },
  });

  const submitVoice = async () => {
    const rec = mediaRef.current;
    if (rec && rec.state === 'recording') {
      const blob = await new Promise<Blob | null>((resolve) => {
        let done = false;
        const onStop = () => {
          const b = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          if (!done) { done = true; resolve(b.size ? b : null); }
        };
        rec.addEventListener('stop', onStop, { once: true });
        rec.stop();
        mediaRef.current = null;
        setTimeout(onStop, 3000);
      });
      if (blob) {
        const up = await run(api.uploadAudio(blob));
        await submitAnswer.mutateAsync({ audioRef: up.ref });
        return;
      }
    }
    await submitAnswer.mutateAsync({ transcript: draft });
  };

  /** 单轮辅导优化（P09）：获取更高分示范与改进建议。 */
  const coachTurn = useMutation({
    mutationFn: async () => {
      const c = await run(api.coach(interviewId!, turn!.id));
      setCoaching({ summary: c.coaching.modelAnswer.summary, structure: c.coaching.modelAnswer.structure, optimization: c.coaching.optimization, note: c.coaching.coachingNote, practice: c.coaching.practicePrompt });
    },
  });

  const finish = useMutation({
    mutationFn: async () => {
      const res = await run(api.finish(interviewId!));
      const detail = await run(api.getInterview(interviewId!));
      setReview(buildReview(detail.interview.turns ?? []));
      const dims = (res.report.dimensionReport ?? []).map((d) => ({ dim: d.dim, displayScore: Math.round(d.overallScore * 20) }));
      setReport({
        avgScore: res.report.overview.avgScore,
        grade: gradeOf(res.report.overview.avgScore),
        completed: res.report.overview.completedAnswers,
        coverage: `${res.report.overview.directionCoverage.covered}/${res.report.overview.directionCoverage.planned}`,
        dims,
        actions: res.report.actionPlan.map((a) => `${a.area}：${a.suggestion}`),
      });
      const prev = await fetchPrevReport(interviewId!);
      setTrend(prev ? buildTrend(prev, res.report.overview.avgScore, dims) : undefined);
      setPage('report');
    },
  });

  const active = page;
  const reportLine = (() => {
    if (!report) return { head: '', sub: '' };
    const sorted = [...report.dims].sort((a, b) => (a.displayScore ?? 0) - (b.displayScore ?? 0));
    const weakest = sorted[0];
    const highest = sorted[sorted.length - 1];
    const band = report.avgScore >= 80 ? '整体表现出色' : report.avgScore >= 70 ? '整体表达清楚' : report.avgScore >= 60 ? '基础可用，但深度与取舍仍有空间' : '整体不足，建议夯实基础后再战';
    const head = `${band}，相对短板在${weakest ? `「${weakest.dim}」` : '综合表现'}。`;
    const trendNote = trend ? (trend.avgDelta > 5 ? `较上一场提升 ${trend.avgDelta} 分，保持住！` : trend.avgDelta < -5 ? `较上一场回落 ${Math.abs(trend.avgDelta)} 分，建议重练短板。` : '较上一场基本持平。') : '';
    const sub = `本场共 ${report.completed} 题，方向覆盖 ${report.coverage}；${highest ? `「${highest.dim}」表现较稳` : '整体较为平均'}。${trendNote}建议聚焦行动清单前几项，补足适用前提、失败处理与验证结果。`;
    return { head, sub };
  })();
  const reviewGroups = review.reduce<{ phase: string; items: typeof review }[]>(
    (acc, it) => {
      const g = acc.find((x) => x.phase === it.phase);
      if (g) g.items.push(it);
      else acc.push({ phase: it.phase, items: [it] });
      return acc;
    },
    [],
  );
  /** 单题回顾内容（题目 + 各次作答）。 */
  const reviewItemJSX = (it: (typeof review)[number]) => (
    <div className="review-item">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <b style={{ minWidth: 0 }}>{it.question}</b>
        {it.score !== undefined ? <span className="tag">{it.score}<small> /100 · {it.grade}</small></span> : <span className="tag">仅记录</span>}
      </div>
      {it.attempts.map((a, j) => (
        <div key={j} style={{ marginTop: 6 }}>
          {a.transcript && <p className="muted" style={{ whiteSpace: 'pre-wrap', marginBottom: 2 }}>{a.transcript}</p>}
          {it.attempts.length > 1 && (
            <small>{a.stage === 'after_hint' ? '复读作答' : '首次作答'} · {a.score !== undefined ? `${a.score} 分` : '仅记录'}</small>
          )}
        </div>
      ))}
    </div>
  );
  const breadcrumb = `首页 / ${titles[active]}`;

  /** 把当前复盘报告导出为 Markdown（含维度、行动项、逐题转写）。 */
  const exportReport = () => {
    if (!report) return;
    const L: string[] = [];
    L.push(`# 复盘报告 · ${role}（${level}）`);
    L.push(`综合表现：${report.avgScore} / 100 · ${report.grade}`);
    L.push(`作答 ${report.completed} 题 · 方向覆盖 ${report.coverage}`);
    L.push('');
    L.push(`## 八维表现`);
    report.dims.forEach((d) => L.push(`- ${d.dim}：${d.displayScore ?? '—'}`));
    if (trend && (trend.dims.length > 0 || trend.avgDelta !== 0)) {
      L.push('');
      L.push(`## vs 上一场`);
      L.push(`- 综合表现：${trend.avgDelta >= 0 ? '▲ +' : '▼ '}${Math.abs(trend.avgDelta)}`);
      trend.dims.forEach((d) => L.push(`- ${d.dim}：${d.delta >= 0 ? '▲ +' : '▼ '}${Math.abs(d.delta)}`));
    }
    L.push('');
    L.push(`## 行动建议`);
    report.actions.forEach((a, i) => L.push(`${i + 1}. ${a}`));
    if (review.length) {
      L.push('');
      L.push(`## 回答转写`);
      for (const g of reviewGroups) {
        L.push('');
        L.push(`### ${phaseLabel[g.phase] ?? g.phase}`);
        const mains = g.items.filter((it) => !it.parentId);
        const children = g.items.filter((it) => it.parentId);
        for (const it of mains) {
          L.push(`- **${it.question}**${it.score !== undefined ? `（${it.score} 分 · ${it.grade}）` : ''}`);
          it.attempts.forEach((a) => a.transcript && L.push(`  - ${a.transcript}`));
          for (const k of children.filter((c) => c.parentId === it.id)) {
            L.push(`  - 追问：${k.question}${k.score !== undefined ? `（${k.score} 分）` : ''}`);
            k.attempts.forEach((a) => a.transcript && L.push(`    - ${a.transcript}`));
          }
        }
      }
    }
    const blob = new Blob([L.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai_interviewer-report-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- 工作台：历史报告 ----
  const [histFilter, setHistFilter] = useState<'all' | 'active' | 'finished'>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const histQuery = useQuery({ queryKey: ['interviews'], queryFn: api.listInterviews, enabled: page === 'home' });
  const history = histQuery.data?.items ?? [];
  const roles = uniqueRoles(history);
  /** 目标岗位缩范围（岗位被删光时回落到「全部」，避免空列表）。 */
  const effectiveRole = roleFilter !== 'all' && !roles.includes(roleFilter) ? 'all' : roleFilter;
  /** 按目标岗位缩范围后的场次（「全部」为 all）。 */
  const scoped = filterByRole(history, effectiveRole);
  const filteredHistory = scoped.filter((h) => (histFilter === 'active' ? h.status !== 'finished' : histFilter === 'finished' ? h.status === 'finished' : true));
  const finCount = scoped.filter((h) => h.status === 'finished').length;
  const avgFinished = (() => {
    const scores = scoped.filter((h) => h.status === 'finished' && h.report).map((h) => h.report!.overview.avgScore);
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  })();
  /** 最近几场综合分（旧→新，按当前岗位范围），用于工作台「成绩走势」。 */
  const scores = recentScores(scoped.filter((h) => h.status === 'finished'), 5);
  const openHistory = useMutation({
    mutationFn: async (id: string) => {
      const detail = await run(api.getInterview(id));
      const r = detail.interview.report;
      if (!r) throw new Error('该场尚无报告');
      // 历史报告以其本场的岗位/级别为准，避免显示当前表单的旧值。
      setRole(detail.interview.targetRole);
      setLevel(detail.interview.level === 'senior' ? '高级' : detail.interview.level === 'junior' ? '初级' : '中级');
      setReview(buildReview(detail.interview.turns ?? []));
      const dims = (r.dimensionReport ?? []).map((d) => ({ dim: d.dim, displayScore: Math.round(d.overallScore * 20) }));
      setReport({
        avgScore: r.overview.avgScore,
        grade: gradeOf(r.overview.avgScore),
        completed: r.overview.completedAnswers,
        coverage: `${r.overview.directionCoverage.covered}/${r.overview.directionCoverage.planned}`,
        dims,
        actions: (r.actionPlan ?? []).map((a) => `${a.area}：${a.suggestion}`),
      });
      const prev = await fetchPrevReport(id);
      setTrend(prev ? buildTrend(prev, r.overview.avgScore, dims) : undefined);
      setPage('report');
    },
    onSuccess: () => histQuery.refetch(),
  });

  /** 中途离开后继续进行中的面试：恢复现场并继续本环节下一题。 */
  const resumeInterview = useMutation({
    mutationFn: async (id: string) => {
      const detail = await run(api.getInterview(id));
      if (detail.interview.status !== 'active') throw new Error('该场不在进行中');
      const turns = detail.interview.turns ?? [];
      const resumePhase = (turns[turns.length - 1]?.phase as Phase) ?? 'intro';
      // 按已有轮次重建各环节已答主问题数（追问轮不计）。
      const progress: Partial<Record<Phase, number>> = {};
      for (const t of turns) {
        if (!t.parentTurnId) progress[t.phase as Phase] = (progress[t.phase as Phase] ?? 0) + 1;
      }
      setPhaseProgress(progress);
      const res = await run(api.newTurn(id, resumePhase));
      setInterviewId(id);
      setStartedAt(detail.interview.startedAt);
      setMode(detail.interview.kind);
      setLevel(detail.interview.level === 'senior' ? '高级' : detail.interview.level === 'junior' ? '初级' : '中级');
      setPhase(resumePhase);
      setTopics(detail.interview.directions);
      setDraft('');
      setScoreHistory([]);
      setCoaching(undefined);
      setRevising(false);
      reanswerStartRef.current = undefined;
      setRecording(false);
      setFollowUpCount(0);
      setAdjustNote('已从上次进度继续，这是本环节下一题。');
      setTurn({ id: res.turn.id, question: res.turn.question, phase: res.turn.phase as Phase, topic: res.turn.topic, difficulty: res.turn.difficulty, targetAspect: res.turn.targetAspect, followup: false });
      setPage('room');
    },
    onSuccess: () => histQuery.refetch(),
  });

  /** 删除一场面试记录（任意状态），删除成功后刷新列表。 */
  const deleteInterview = useMutation({
    mutationFn: async (id: string) => {
      await run(api.deleteInterview(id));
      histQuery.refetch();
    },
  });

  // ---- 管理员提示词管理 ----
  const [selId, setSelId] = useState<string>();
  const [draftText, setDraftText] = useState('');

  // ---- 模型供应商设置 ----
  const modelQuery = useQuery({ queryKey: ['modelSettings'], queryFn: api.getModelSettings, enabled: page === 'settings' });
  const [cfgMode, setCfgMode] = useState<{ baseUrl: string; model: string; apiKey: string; mode: 'platform' | 'custom' }>({ baseUrl: '', model: '', apiKey: '', mode: 'custom' });
  useEffect(() => {
    const s = modelQuery.data?.status;
    if (s) setCfgMode((c) => ({ ...c, baseUrl: s.baseUrl ?? c.baseUrl, model: s.model ?? c.model }));
  }, [modelQuery.data?.status?.model, modelQuery.data?.status?.baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveModel = useMutation({
    mutationFn: async () => {
      await api.setModelConfig({ mode: cfgMode.mode, baseUrl: cfgMode.baseUrl, model: cfgMode.model, apiKey: cfgMode.apiKey || undefined });
      modelQuery.refetch();
    },
  });
  const applyPreset = (p: { baseUrl: string; model: string }) => setCfgMode((c) => ({ ...c, baseUrl: p.baseUrl, model: p.model, mode: 'custom' }));
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number; error?: string }>();
  const testModel = useMutation({
    mutationFn: async () => {
      // 测试当前选中的配置（custom 用表单候选，不切换运行态）
      const r = await api.testModel({ mode: cfgMode.mode, baseUrl: cfgMode.baseUrl, model: cfgMode.model, apiKey: cfgMode.apiKey || undefined });
      setTestResult(r);
      return r;
    },
  });

  // 面试室内软计时：每 30s 刷新，用于「到时提示收尾」而非强制截断。
  useEffect(() => {
    if (page !== 'room' || !startedAt) return;
    const t = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(t);
  }, [page, startedAt]);
  const tplQuery = useQuery({ queryKey: ['adminTemplates'], queryFn: api.listTemplates, enabled: page === 'admin' });
  const verQuery = useQuery({ queryKey: ['adminVersions', selId], queryFn: () => api.listVersions(selId!), enabled: !!selId && page === 'admin' });
  const selectedVersions = useMemo(() => (verQuery.data ? [...verQuery.data.items].sort((a, b) => b.versionNo - a.versionNo) : []), [verQuery.data]);
  const workingDraft = useMemo(() => selectedVersions.find((v) => v.status === 'draft' || v.status === 'tested'), [selectedVersions]);
  useEffect(() => {
    if (workingDraft) setDraftText(workingDraft.content);
  }, [workingDraft?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshAdmin = () => { tplQuery.refetch(); if (selId) verQuery.refetch(); };
  const saveDraft = useMutation({
    mutationFn: async () => { await api.updateDraft(selId!, draftText); refreshAdmin(); },
  });
  const verAct = useMutation({
    mutationFn: async (a: { action: 'test' | 'publish' | 'rollback'; targetId?: string }) => {
      await api.actVersion(selId!, a.action, a.targetId);
      refreshAdmin();
    },
  });

  return (
    <div id="viewport">
      <div id="app">
        <div className="shell">
          <aside className="sidebar">
            <div className="logo"><span className="logo-mark">◈</span>ai_interviewer</div>
            <nav className="nav">
              {nav.map((n) => (
                <button key={n.k} className={active === n.k ? 'active' : ''} onClick={() => setPage(n.k)}>
                  <span className="navicon">{n.icon}</span>{n.label}
                </button>
              ))}
            </nav>
            <div className="sidebar-foot">
              <span className="avatar">林</span><span><b>林同学</b> <small>示例账号</small></span>
            </div>
          </aside>

          <div className="main">
            <header className="topbar">
              <div className="breadcrumb"><strong>{titles[active]}</strong></div>
              <div className="row">
                {active === 'room' && <span className="tag blue">{mode === 'coach' ? '陪练模式' : '模拟面试'}</span>}
                {active === 'report' && <span className="tag amber">复盘报告</span>}
              </div>
            </header>
            <div className="content">
              {error && <div className="notice amber" style={{ marginBottom: 16 }}>请求失败：{error}</div>}

              {active === 'home' && (
                <>
                  <section className="card hero">
                    <div>
                      <div className="eyebrow">START PRACTICING</div>
                      <h1>把这次经历，<br />变成下次的成功。</h1>
                      <p>围绕你的简历与目标岗位，生成有来由的面试练习。当场评分、追问与复盘，一次比一次更接近目标。</p>
                    </div>
                    <div className="hero-art" aria-hidden>{[0, 1, 2, 3].map((i) => <i key={i} />)}</div>
                  </section>
                  <div className="grid3 section-title">
                    <section className="card"><small>已练习场次</small><div className="metric">{history.length}<span>场</span></div></section>
                    <section className="card"><small>已完成</small><div className="metric">{finCount}<span>场</span></div></section>
                    <section className="card"><small>平均表现</small><div className="metric">{avgFinished ? `${avgFinished}分` : '—'}<span>{avgFinished ? gradeOf(avgFinished) : '暂无'}</span></div></section>
                  </div>

                  {scores.length > 0 && (
                    <section className="card" style={{ marginTop: 18 }}>
                      <div className="row between" style={{ marginBottom: 10 }}>
                        <h3 style={{ margin: 0 }}>成绩走势</h3>
                        {scores.length >= 2 && (() => { const d = scores[scores.length - 1] - scores[0]; return <span className={`tag ${d > 0 ? 'green' : d < 0 ? 'amber' : ''}`}>{d >= 0 ? '▲' : '▼'} 首尾 {Math.abs(d)} 分</span>; })()}
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        {scores.map((s, i) => <span className="tag" key={i}>{s}<small> /100</small></span>)}
                      </div>
                    </section>
                  )}

                  {history.length > 0 && (
                    <section className="card section-title">
                      {roles.length > 1 && (
                        <div className="row" style={{ marginBottom: 14, gap: 6 }}>
                          <small style={{ marginRight: 4 }}>岗位：</small>
                          {['all', ...roles].map((r) => (
                            <button key={r} aria-pressed={roleFilter === r} onClick={() => setRoleFilter(r)} style={{ padding: '4px 10px', fontSize: 12 }}>{r === 'all' ? '全部' : r}</button>
                          ))}
                        </div>
                      )}
                      <div className="row between"><h2>历史场次</h2>
                        <div className="row" style={{ gap: 4 }}>
                          {([['all', '全部'], ['active', '进行中'], ['finished', '已完成']] as const).map(([k, label]) => (
                            <button key={k} aria-pressed={histFilter === k} onClick={() => setHistFilter(k)} style={{ padding: '5px 10px', fontSize: 12 }}>{label}</button>
                          ))}
                        </div>
                      </div>
                      {filteredHistory.map((h) => (
                        <div className="list-row" key={h.id}>
                          <div>
                            <b>{h.targetRole} · {h.level === 'mid' ? '中级' : h.level === 'junior' ? '初级' : '高级'}</b>
                            <p>{h.kind === 'coach' ? '陪练' : '模拟'} · {h.status === 'finished' ? `报告 ${h.report?.overview.avgScore} 分 · 完成 ${h.report?.overview.completedAnswers} 题` : h.status === 'active' ? '进行中' : '草稿'} · {new Date(h.updatedAt).toLocaleString()}</p>
                          </div>
                          {h.status === 'finished' ? (
                            <button onClick={() => openHistory.mutate(h.id)} disabled={openHistory.isPending}>查看报告</button>
                          ) : h.status === 'active' ? (
                            <button onClick={() => resumeInterview.mutate(h.id)} disabled={resumeInterview.isPending}>{resumeInterview.isPending ? '继续中…' : '继续'}</button>
                          ) : (
                            <span className="tag">{h.status}</span>
                          )}
                          <button className="danger ghost" onClick={() => { if (window.confirm('删除这场面试记录？')) deleteInterview.mutate(h.id); }} disabled={deleteInterview.isPending}>删除</button>
                        </div>
                      ))}
                    </section>
                  )}

                  <div className="actions"><button className="primary" onClick={() => setPage('resume')}>开始新的面试 →</button></div>
                </>
              )}

              {active === 'resume' && (
                <div className="grid2">
                  <section className="card">
                    <div className="eyebrow">01 / 认识你的经历</div>
                    <h2>导入简历</h2>
                    <div className="dropzone">
                      <div className="upload-icon">↥</div>
                      <h3>粘贴简历内容 或 上传 .md/.txt</h3>
                      <p>PDF、DOCX、Markdown、TXT（MVP 读取 .md/.txt，其余请粘贴）</p>
                      <textarea data-field="resumeText" value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="粘贴你的项目经历、技术栈与工作经历…" />
                      <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
                        <input type="file" accept=".md,.txt,.pdf,.docx" onChange={pickResumeFile} aria-label="选择简历文件" />
                      </div>
                    </div>
                    <div className="actions">
                      <button className="primary" onClick={() => parseResume.mutate()} disabled={parseResume.isPending}>
                        {parseResume.isPending ? '解析中…' : '载入示例分析 →'}
                      </button>
                    </div>
                  </section>
                  <section className="card">
                    <div className="row between"><h2>确认分析结果</h2><span className="tag blue">{structured ? '待你确认' : '示例'}</span></div>
                    <label className="field">候选人概况<input value={analysis ?? '林同学 · Java 后端 · 3 年'} readOnly /></label>
                    {structured ? (
                      <>
                        {(structured.skills ?? []).map((s) => <span className="tag" key={s.name} style={{ marginRight: 6 }}>{s.name}{s.level ? ` · ${s.level}` : ''}</span>)}
                        {(structured.experiences ?? []).map((e, i) => (
                          <div className="resume-block" key={i} style={{ marginTop: 14 }}>
                            <h3>{e.company} · {e.role}</h3>
                            <p>{e.period}</p>
                            {(e.bullets ?? []).map((b, j) => <p key={j} style={{ marginBottom: 4 }}>· {b}</p>)}
                          </div>
                        ))}
                        {(structured.projects ?? []).map((p, i) => (
                          <div className="resume-block" key={`p-${i}`} style={{ marginTop: 14 }}>
                            <h3>{p.name} · {p.role}</h3>
                            <p>{p.stack.join(' / ')}</p>
                            {(p.points ?? []).map((pt, j) => <p key={j} style={{ marginBottom: 4 }}>· {pt}</p>)}
                          </div>
                        ))}
                      </>
                    ) : (
                      <div className="resume-block"><h3>电商订单与库存服务</h3><p>负责订单接口与促销库存扣减改造，参与压测及重复下单处理方案讨论。</p></div>
                    )}
                    <div className="actions">
                      <button className="primary" onClick={() => setPage('prepare')} disabled={!resumeId}>确认分析，进入准备 →</button>
                    </div>
                  </section>
                </div>
              )}

              {active === 'prepare' && (
                <div className="conversation">
                  <div className="message">
                    <span className="bot">ai</span>
                    <section className="bubble">
                      {(!resumeId || !interviewId) ? (
                        <>
                          <h3>先告诉我这次的目标岗位。</h3>
                          <div className="fields">
                            <label className="field">目标岗位<input value={role} onChange={(e) => setRole(e.target.value)} /></label>
                            <label className="field">目标级别<select value={level} onChange={(e) => setLevel(e.target.value)}><option>初级</option><option>中级</option><option>高级</option></select></label>
                          </div>
                          <h3 style={{ marginTop: 18 }}>选择本次练习方式</h3>
                          <div className="choice">
                            <button aria-pressed={mode === 'coach'} onClick={() => setMode('coach')}>陪练模式<small>每轮评分与建议，边练边改。</small></button>
                            <button aria-pressed={mode === 'mock'} onClick={() => setMode('mock')}>模拟面试<small>过程中不提示，结束后统一复盘。</small></button>
                          </div>
                          <h3 style={{ marginTop: 18 }}>计划时长</h3>
                          <div className="choice">
                            {[['15m', '专项'], ['30m', '标准'], ['45m', '深度']].map(([m, t]) => (
                              <button key={m} aria-pressed={duration === m} onClick={() => setDuration(m as typeof duration)}>{t}练习<small>{m} 分钟</small></button>
                            ))}
                          </div>
                          <label className="row" style={{ marginTop: 18, fontSize: 12 }}>
                            <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} />保留本场录音，方便回听
                          </label>
                          <div className="actions"><button className="primary" onClick={() => bootstrap.mutate()} disabled={bootstrap.isPending}>{bootstrap.isPending ? '生成面试计划…' : '查看面试流程 →'}</button></div>
                        </>
                      ) : (
                        <>
                          <h3>这些方向，值得一起深入。 <span className="tag blue">可多选</span></h3>
                          <div className="topic-grid">
                            {dirs.map((d) => {
                              const on = selectedDirs.includes(d.id);
                              return (
                                <div className="topic" key={d.id} role="button" tabIndex={0} aria-pressed={on} onClick={() => setSelectedDirs((s) => (on ? s.filter((x) => x !== d.id) : [...s, d.id]))} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedDirs((s) => (on ? s.filter((x) => x !== d.id) : [...s, d.id])); } }} style={{ borderColor: on ? '#96b3f8' : undefined, background: on ? '#f6f9ff' : undefined }}>
                                  <span className="step-number">{Math.round(d.weight * 10)}</span>
                                  <span><b>{d.name}</b><small>{d.reason}</small></span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="row" style={{ marginTop: 10 }}><small>已选 {selectedDirs.length} 个方向</small></div>
                          <h3 style={{ marginTop: 18 }}>目标岗位：{role} · {level}</h3>
                          <div className="row">{topics.map((t) => <span className="summary-chip" key={t}>{t}</span>)}</div>
                          {outlinePhases && outlinePhases.length > 0 && (
                            <div className="flow" style={{ marginTop: 22 }}>
                              {outlinePhases.map((p) => (
                                <div className="flow-node" key={p.phase}>
                                  <span className="step-number">{p.phase === 'intro' ? '1' : p.phase === 'tech' ? '2' : p.phase === 'biz' ? '3' : '4'}</span>
                                  <b>{phaseLabel[p.phase] ?? p.phase}</b>
                                  <p>{p.minutes} 分钟 · {p.questionCount} 题{p.focus?.length ? ` · ${p.focus.join('/')}` : ''}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          {outlineQuestions && outlineQuestions.length > 0 && (
                            <details style={{ marginTop: 14 }}>
                              <summary>题目预览（{outlineQuestions.length} 道）</summary>
                              <p style={{ marginTop: 10 }}>{outlineQuestions.map((q) => `· ${q.mainQuestion}`).join('\n')}</p>
                            </details>
                          )}
                          <div className="actions">
                            {topics.length === 0 ? (
                              <button className="primary" onClick={() => generatePlan.mutate()} disabled={generatePlan.isPending}>{generatePlan.isPending ? '生成面试流程…' : '按所选生成面试流程 →'}</button>
                            ) : (
                              <button className="primary" onClick={() => beginTurn.mutate()} disabled={beginTurn.isPending}>{beginTurn.isPending ? '准备题目…' : '开始自我介绍 →'}</button>
                            )}
                          </div>
                        </>
                      )}
                    </section>
                  </div>
                </div>
              )}

              {active === 'room' && (
                <div className="room">
                  <aside className="card outline">
                    <h3>本场流程</h3>
                    {stages.map((name, i) => {
                      const idx = PHASES.indexOf(phase);
                      const ph = PHASES[i];
                      const state = phase && i < idx ? 'done' : phase && i === idx ? 'active' : '';
                      const done = phaseProgress[ph] ?? 0;
                      const planned = outlinePhases?.find((p) => p.phase === ph)?.questionCount;
                      return (
                        <div className={`stage ${state}`} key={name}><span className="step-number">{i < (phase ? PHASES.indexOf(phase) : -1) ? '✓' : `${i + 1}`}</span><div><b>{name}</b><small>{state === 'done' ? '已完成' : state === 'active' ? '进行中' : '待开始'}{planned ? ` · 已答 ${done}/${planned} 题` : done ? ` · 已答 ${done} 题` : ''}</small></div></div>
                      );
                    })}
                    {adjustNote && <div className="notice" style={{ marginTop: 10 }}>{adjustNote}</div>}
                    <div className="room-meta">{duration} 分钟 · {level}
                      {(() => {
                        const budget = parseInt(duration, 10);
                        const elapsed = startedAt ? Math.max(0, Math.floor((clock - new Date(startedAt).getTime()) / 60000)) : 0;
                        const overdue = startedAt && elapsed >= budget;
                        return (<span>{overdue ? ` ｜ 已超时（已进行 ${elapsed} 分钟，可收尾）` : startedAt ? ` ｜ 已进行 ${elapsed} / ${budget} 分钟` : ''}</span>);
                      })()}
                      <br />{topics.join(' / ')}</div>
                  </aside>
                  <section className="card">
                    <div className="row between"><span className="tag blue">主问题</span><small>语音问答 · 可输入文本作答</small></div>
                    <div className="row" style={{ marginTop: 22 }}><span className="bot">面试官</span><div><b>面试官</b><br /><small>沿着你的回答继续深入</small></div></div>
                    <h2 className="question">{turn?.question ?? '点击开始，面试官将提出第一题。'}</h2>
                    {turn?.answered ? null : (
                      <div className="row" style={{ marginTop: 6, gap: 6 }}>
                        {turn?.topic && <span className="tag">主题：{turn.topic}</span>}
                        {turn?.difficulty && <span className="tag">{({ begin: '基础', mid: '进阶', deep: '深挖' } as Record<string, string>)[turn.difficulty] ?? turn.difficulty}</span>}
                        {turn?.targetAspect && <span className="tag">侧重：{turn.targetAspect}</span>}
                      </div>
                    )}
                    <div className="question-context">先完整表达你的思路，再提交获得反馈。</div>
                    <div className="answer">
                      {!turn?.answered && (
                        <div className={recording ? 'voice recording' : 'voice'}>
                          <div className="wave" aria-hidden>{Array.from({ length: 9 }).map((_, i) => <i key={i} />)}</div>
                          {!recording ? (
                            <button className="primary" onClick={startRec} disabled={!turn}>
                              ● 开始回答（录音）
                            </button>
                          ) : (
                            <button className="primary" onClick={submitVoice} disabled={submitAnswer.isPending}>
                              {submitAnswer.isPending ? '上传并评价…' : '■ 回答完成'}
                            </button>
                          )}
                          <p>{recording ? '录音中 · 完成后上传做语音转写（无麦克风则自动用文本）' : '手动开始 · 手动提交 · 留出思考时间'}</p>
                        </div>
                      )}
                      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="亦可直接输入你的回答…" disabled={!!turn?.answered || submitAnswer.isPending} />
                      {!turn?.answered ? (
                        <div className="actions" style={{ marginTop: 10 }}>
                          <button className="ghost" onClick={() => submitAnswer.mutate({ transcript: draft })} disabled={submitAnswer.isPending || !turn}>
                            {submitAnswer.isPending ? '上传并评价…' : '用文本文案提交'}
                          </button>
                        </div>
                      ) : (
                        <div className="actions" style={{ marginTop: 10 }}>
                          {mode === 'coach' && !scoreHistory.some((s) => s.stage === 'after_hint') && (
                            <button className="ghost" onClick={() => { setRevising(true); setDraft(''); setRecording(false); mediaRef.current?.stop(); mediaRef.current = null; reanswerStartRef.current = Date.now(); setTurn({ ...turn!, answered: undefined }); }}>重新回答</button>
                          )}
                          {mode === 'coach' && turn.answered?.followup.length ? (
                            <button onClick={() => askFollowUp.mutate()} disabled={askFollowUp.isPending || followUpCount >= 3}>{followUpCount >= 3 ? '追问已满' : '追问 →'}</button>
                          ) : null}
                          {phase !== 'intro' && (
                            <button onClick={() => beginTurn.mutate()} disabled={beginTurn.isPending}>同环节再问一题</button>
                          )}
                          <button onClick={advance}>{phase === 'hr' ? '完成面试' : '下一环节 →'}</button>
                          <button className="primary" onClick={goFinish} disabled={finish.isPending}>{finish.isPending ? '生成报告…' : '完成面试，查看报告 →'}</button>
                        </div>
                      )}
                    </div>
                  </section>
                  <aside className="card feedback">
                    {!turn?.answered ? (
                      <div className="empty"><div className="empty-icon">◌</div>回答结束后，<br />在这里查看评分与优化建议。</div>
                    ) : (
                      <>
                        <div className="row between"><h3>本轮反馈</h3><span className="tag blue">{mode === 'mock' ? '模拟' : '陪练'}</span></div>
                        {turn.answered.recorded ? (
                          <div className="empty" style={{ padding: '16px 0' }}>
                            <div className="empty-icon">◎</div>
                            模拟面试进行中<br />本场结束后统一展示评价。
                          </div>
                        ) : (
                          <>
                            {scoreHistory.length > 1 ? (
                              <div className="revise-compare">
                                <p className="subtitle">首次 {scoreHistory[0].score} 分（{scoreHistory[0].grade}） → 复发 {scoreHistory[scoreHistory.length - 1].score} 分（{scoreHistory[scoreHistory.length - 1].grade}）· 逐维并列，不以提示后最高分计入</p>
                                {turn.reanswer && <p className="subtitle">反馈阅读 {durLabel(turn.reanswer.readMs)} · 重答用时 {durLabel(turn.reanswer.reanswerMs)}</p>}
                                <div className="score-row"><span style={{ minWidth: 92 }}>维度</span><span className="bar" /><b>首次</b><span className="bar" /><b>复发</b></div>
                                {compareDims.map((c) => (
                                  <div className="score-row" key={c.dim}>
                                    <span style={{ minWidth: 92 }}>{c.dim}</span>
                                    <span className="bar"><i style={{ width: `${c.a ?? 0}%` }} /></span><b>{c.a ?? '—'}</b>
                                    <span className="bar"><i style={{ width: `${c.b ?? 0}%` }} /></span><b>{c.b ?? '—'}</b>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            <div className="score">{turn.answered.score}<small> / 100 · {turn.answered.grade}</small></div>
                            <p className="subtitle">{turn.answered.overall}</p>
                            {scoreHistory.length < 2 && turn.answered.dims.map((d) => (
                              <div className="score-row" key={d.dim}><span>{d.dim}</span><span className="bar"><i style={{ width: `${d.displayScore ?? 0}%` }} /></span><span>{d.displayScore ?? '—'}</span></div>
                            ))}
                            <div className="feedback-block"><h3>做得好的地方</h3><p>{turn.answered.strengths.join('；') || '—'}</p></div>
                            <div className="feedback-block"><h3>还缺少什么</h3><p>{turn.answered.weaknesses.join('；') || turn.answered.suggestion}</p></div>
                            {turn.answered.misconceptions && turn.answered.misconceptions.length > 0 && (
                              <div className="feedback-block"><h3>误区澄清</h3>{turn.answered.misconceptions.map((m, i) => (
                                <div key={i} style={{ marginTop: 8 }}>
                                  <span className="tag amber" style={{ marginRight: 6 }}>{({ knowledge: '知识误区', asr: '转写误识', assumption: '前提假设' } as Record<string, string>)[m.kind ?? 'knowledge']}</span>
                                  <p className="quote" style={{ marginTop: 6 }}>「{m.quote}」→ {m.clarification}</p>
                                </div>
                              ))}</div>
                            )}
                            {turn.answered.followup.length > 0 && <div className="feedback-block"><h3>推荐追问</h3><p>{turn.answered.followup.join('；')}</p></div>}
                            <div className="feedback-block">
                              {coaching ? (
                                <>
                                  <div className="row between"><h3>更高分示范（P09）</h3><small>基于本次作答</small></div>
                                  <p>{coaching.summary}</p>
                                  {coaching.structure.map((s, i) => (
                                    <div className="list-row" key={i} style={{ padding: '8px 0' }}><b style={{ minWidth: 0 }}>{s.point}</b><small style={{ minWidth: 0, marginLeft: 8 }}>{s.explanation}</small></div>
                                  ))}
                                  {coaching.optimization?.map((o, i) => (
                                    <div key={`opt-${i}`} className="stack" style={{ gap: 4, marginTop: 8 }}>
                                      <small>原答「{o.userPoint}」→ 更优「{o.improved}」（{o.why}）</small>
                                    </div>
                                  ))}
                                  {coaching.note && <p className="muted">{coaching.note}</p>}
                                  {coaching.practice && <p className="muted">练习建议：{coaching.practice}</p>}
                                </>
                              ) : (
                                <button className="ghost" onClick={() => coachTurn.mutate()} disabled={coachTurn.isPending}>{coachTurn.isPending ? '生成中…' : '查看更高分示范 →'}</button>
                              )}
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </aside>
                </div>
              )}

              {active === 'report' && report && (
                <>
                  <section className="card">
                    <div className="report-top">
                      <div className="big-score"><strong>{report.avgScore}</strong><small>综合表现 / 100 · {report.grade}</small></div>
                      <div>
                        <h2>{reportLine.head}</h2>
                        <p className="muted">{reportLine.sub}</p>
                        <div className="row"><span className="tag">{role}</span><span className="tag">{level}</span><span className="tag blue">复盘报告</span></div>
                      </div>
                    </div>
                    <div className="dimension-grid" style={{ marginTop: 25 }}>
                      {report.dims.map((d) => (
                        <div className="score-row" key={d.dim}><span style={{ minWidth: 100 }}>{d.dim}</span><span className="bar"><i style={{ width: `${d.displayScore ?? 0}%` }} /></span><b>{d.displayScore ?? '—'}</b></div>
                      ))}
                    </div>
                    {trend && (trend.dims.length > 0 || trend.avgDelta !== 0) && (
                      <div className="trend-block">
                        <div className="row between" style={{ marginBottom: 10 }}>
                          <b>vs 上一场</b>
                          <span className={`delta ${trend.avgDelta >= 0 ? 'up' : 'down'}`}>{trend.avgDelta >= 0 ? '▲' : '▼'} 综合 {Math.abs(trend.avgDelta)} 分</span>
                        </div>
                        <div className="dimension-grid">
                          {trend.dims.map((d) => (
                            <div className="score-row" key={d.dim}><span style={{ minWidth: 100 }}>{d.dim}</span><span className={`delta ${d.delta >= 0 ? 'up' : 'down'}`}>{d.delta >= 0 ? '▲' : '▼'} {Math.abs(d.delta)}</span></div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                  <div className="grid2 section-title">
                    <section className="card"><h2>下一个题，专注这三件事</h2>
                      {report.actions.map((a, i) => <div className="list-row" key={i}><div className="row"><span className="step-number">0{i + 1}</span><div><b>{a}</b></div></div></div>)}
                    </section>
                  </div>

                  {review.length > 0 && (
                    <section className="card section-title">
                      <div className="row between"><h2>回答转写回顾</h2><span className="tag blue">{review.length} 题</span></div>
                      {reviewGroups.map((g) => {
                        const mains = g.items.filter((it) => !it.parentId);
                        const children = g.items.filter((it) => it.parentId);
                        const orphans = children.filter((c) => !mains.some((m) => m.id === c.parentId));
                        return (
                          <div key={g.phase} className="review-phase">
                            <div className="row" style={{ marginTop: 10 }}><span className="tag blue">{phaseLabel[g.phase] ?? g.phase}</span><small>{g.items.length} 题</small></div>
                            {[...mains, ...orphans].map((it) => {
                              const kids = children.filter((c) => c.parentId === it.id);
                              return (
                                <div key={it.id}>
                                  {reviewItemJSX(it)}
                                  {kids.map((k) => (
                                    <div key={k.id} style={{ marginLeft: 18, borderLeft: '2px solid var(--line)', paddingLeft: 12 }}>
                                      <small className="muted">追问</small>
                                      {reviewItemJSX(k)}
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </section>
                  )}
                  <div className="actions"><button onClick={exportReport}>导出报告 ⤓</button><button className="primary" onClick={() => { setPage('home'); setInterviewId(undefined); setPhase('intro'); setTurn(undefined);
      setPhaseProgress({}); setReport(undefined);
      setTrend(undefined); setReview([]); setCoaching(undefined); setTopics([]); setOutlinePhases(undefined);
      setOutlineQuestions(undefined); setSelectedDirs([]); setDirs([]); setAdjustNote(undefined); setStartedAt(undefined); }}>再来一次 →</button></div>
                </>
              )}

              {active === 'admin' && (
                <div className="grid2">
                  <section className="card">
                    <div className="row between"><h2>任务模板</h2><span className="tag blue">P01—P10</span></div>
                    {tplQuery.isLoading ? <p className="muted">加载中…</p> : (tplQuery.data?.items ?? []).map((t) => (
                      <div className="list-row" key={t.id}>
                        <div><b>{t.taskCode} · {t.name}</b><p>{t.description}</p></div>
                        <button className={selId === t.id ? 'primary' : ''} onClick={() => setSelId(t.id)}>编辑</button>
                      </div>
                    ))}
                  </section>
                  <section className="card">
                    <h2>模板草稿</h2>
                    {!selId ? (
                      <div className="empty">选择一个任务模板开始编辑。<br />MVP 中模板为管理数据，尚不影响 Mock 生成。</div>
                    ) : (
                      <>
                        <label className="field">基础提示词<textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={8} /></label>
                        <div className="row between">
                          <div className="row">
                            <button className="primary" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}>保存草稿</button>
                            <button onClick={() => verAct.mutate({ action: 'test' })} disabled={verAct.isPending}>示例测试</button>
                            <button disabled={workingDraft?.status !== 'tested' || verAct.isPending} onClick={() => verAct.mutate({ action: 'publish' })} title="须先通过测试">发布</button>
                          </div>
                          {workingDraft && <span className="tag">{workingDraft.status === 'tested' ? '已测试' : '草稿'}</span>}
                        </div>
                        <h3 style={{ marginTop: 20 }}>版本时间线</h3>
                        {selectedVersions.map((v) => (
                          <div className="list-row" key={v.id}>
                            <div className="row">{`v${v.versionNo}`}
                              <span className="tag">{v.status}</span>
                              {v.basedOnId && <small>回滚自 {v.id.slice(0, 8)}</small>}
                            </div>
                            {v.status === 'published' && <button onClick={() => verAct.mutate({ action: 'rollback', targetId: v.id })} disabled={verAct.isPending}>回滚到此</button>}
                          </div>
                        ))}
                      </>
                    )}
                  </section>
                </div>
              )}

              {active === 'settings' && (
                <div className="grid2">
                  <section className="card"><h2>模型配置</h2>
                    <div className="choice" style={{ marginBottom: 4 }}>
                      <button aria-pressed={cfgMode.mode === 'platform'} onClick={() => setCfgMode((c) => ({ ...c, mode: 'platform' }))}>平台默认<small>按服务端环境配置</small></button>
                      <button aria-pressed={cfgMode.mode === 'custom'} onClick={() => setCfgMode((c) => ({ ...c, mode: 'custom' }))}>自定义 API<small>使用自己的服务配置</small></button>
                    </div>
                    <div className="row" style={{ marginTop: 14 }}>
                      {(modelQuery.data?.presets ?? []).map((p) => (
                        <button key={p.id} onClick={() => applyPreset(p)}>{p.vendor}</button>
                      ))}
                    </div>
                    <label className="field" style={{ marginTop: 12 }}>Base URL<input value={cfgMode.baseUrl} disabled={cfgMode.mode === 'platform'} onChange={(e) => setCfgMode((c) => ({ ...c, baseUrl: e.target.value }))} placeholder="https://open.bigmodel.cn/api/paas/v4" /></label>
                    <label className="field">模型名<input value={cfgMode.model} disabled={cfgMode.mode === 'platform'} onChange={(e) => setCfgMode((c) => ({ ...c, model: e.target.value }))} placeholder="glm-4-flash" /></label>
                    <label className="field">API Key<input type="password" value={cfgMode.apiKey} disabled={cfgMode.mode === 'platform'} onChange={(e) => setCfgMode((c) => ({ ...c, apiKey: e.target.value }))} placeholder="sk-…（可选，保存在服务端内存）" /></label>
                    <div className="actions">
                      <button className="primary" onClick={() => saveModel.mutate()} disabled={saveModel.isPending}>{saveModel.isPending ? '保存中…' : '保存并生效'}</button>
                      <button onClick={() => testModel.mutate()} disabled={testModel.isPending}>{testModel.isPending ? '测试中…' : '测试连接'}</button>
                      <span className="tag">{modelQuery.data ? { mock: '默认样本（无需密钥）', platform: '平台默认', custom: '自定义 API' }[modelQuery.data.status.mode] : '加载中…'}</span>
                    </div>
                    {testResult && (
                      <div className="notice" style={{ marginTop: 12, ...(testResult.ok ? { background: '#edf8f3', color: 'var(--green)' } : { background: '#fff1f0', color: '#b34545' }) }}>
                        {testResult.ok ? `连接成功 · 延迟 ${testResult.latencyMs} ms` : `连接失败：${testResult.error ?? '未知错误'}`}
                      </div>
                    )}
                  </section>
                  <section className="card"><h2>账号与数据</h2>
                    <div className="setting-row"><div><b>林同学 · 演示账号</b><p>Web 与小程序使用同一份练习记录</p></div><span className="tag">示例</span></div>
                    <div className="setting-row"><div><b>回答录音</b><p>每场开始前，由你选择是否保留</p></div>{keepAudio ? <span className="tag green">本场保留</span> : <span className="tag">仅转写</span>}</div>
                  </section>
                </div>
              )}
            </div>
          </div>
            <nav className="mobile-nav">
              {nav.map((n) => (
                <button key={n.k} className={active === n.k ? 'active' : ''} onClick={() => setPage(n.k)}>
                  <span>{n.icon}</span>{n.label}
                </button>
              ))}
            </nav>
        </div>
      </div>
    </div>
  );
}