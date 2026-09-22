import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { gradeOf } from '@ai-interviewer/contracts';
import { api, audioSrc, type AnswerResult, type AnswerStreamProgress, type InterviewDetail, type InterviewReport, type PlanStreamProgress, type ResumeStreamProgress } from './api';
import { buildTrend } from './lib/trend';
import { recentScores, type ScorePoint } from './lib/session-trend';
import { filterByRole, uniqueRoles } from './lib/session-filter';
import { durLabel } from './lib/durations';
import { avgDims } from './lib/dim-avg';
import mascotLogo from './assets/ai-interviewer-mascot.png';

type NavKey = 'home' | 'resume' | 'prepare' | 'room' | 'report' | 'settings' | 'admin';
const titles: Record<NavKey, string> = { home: '工作台', resume: '我的简历', prepare: '准备面试', room: '面试练习室', report: '复盘报告', settings: '设置', admin: '提示词管理' };

type IconName = 'home' | 'resume' | 'prepare' | 'room' | 'report' | 'settings' | 'admin';

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="m3.5 10.5 8.5-7 8.5 7" /><path d="M5.5 9.5v10h13v-10" /><path d="M9.5 19.5v-5h5v5" /></>,
    resume: <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></>,
    prepare: <><path d="M12 4v16M4 12h16" /></>,
    room: <><rect x="3.5" y="5" width="17" height="13.5" rx="3" /><path d="M8 18.5v2l4-2h3.5" /><path d="M8 10.5h8M8 14h5" /></>,
    report: <><path d="M5 19V9M12 19V5M19 19v-7" /><path d="M3.5 19.5h17" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.4 1.4-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L9 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H7v-2h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L8.4 9 9.8 7.6l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h2v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.2 9l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v2h-.2a1.7 1.7 0 0 0-1.6 1Z" /></>,
    admin: <><path d="M5 4.5h14v15H5z" /><path d="m8 8 2 2-2 2M12 12h4M8 15h8" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function BrandMark() {
  return <img className="brand-mascot" src={mascotLogo} alt="" aria-hidden="true" />;
}
/** 面试风格预设：只影响反馈文案口径，不改变评分标准。 */
const STYLES: { id: 'professional' | 'coaching' | 'concise'; name: string; desc: string }[] = [
  { id: 'professional', name: '严谨专业', desc: '点评聚焦前提与失败处理，追问犀利' },
  { id: 'coaching', name: '循循善诱', desc: '多给提示与鼓励，追问渐进' },
  { id: 'concise', name: '简洁高效', desc: '反馈简短，直击要点' },
];
const nav: { k: NavKey; icon: IconName; label: string }[] = [
  { k: 'home', icon: 'home', label: '工作台' },
  { k: 'resume', icon: 'resume', label: '我的简历' },
  { k: 'prepare', icon: 'prepare', label: '准备面试' },
  { k: 'room', icon: 'room', label: '面试练习室' },
  { k: 'report', icon: 'report', label: '复盘报告' },
  { k: 'settings', icon: 'settings', label: '设置' },
  { k: 'admin', icon: 'admin', label: '提示词管理' },
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

/** 全局确认弹窗的通用入参。 */
interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 是否危险操作（删除类），确定按钮红色强调。 */
  danger?: boolean;
}

/**
 * 全局确认弹窗：固定窗口正中央，遮罩 + 品牌化卡片。
 * 由 App 内 confirmUser 状态驱动，统一替代 window.confirm。
 */
function ConfirmDialog({ opts, onConfirm, onCancel }: { opts: ConfirmOptions; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="confirm-overlay" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={onCancel}>
      <div className={`confirm-dialog${opts.danger ? ' danger' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon" aria-hidden>{opts.danger ? '🗑' : '❓'}</div>
        <h3 id="confirm-title">{opts.title ?? (opts.danger ? '确认删除' : '请确认')}</h3>
        <p className="confirm-message">{opts.message}</p>
        <div className="confirm-actions">
          <button className="ghost" onClick={onCancel} autoFocus>{opts.cancelText ?? '取消'}</button>
          <button className={opts.danger ? 'danger' : 'primary'} onClick={onConfirm}>{opts.confirmText ?? '确定'}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 成绩走势折线图：内联 SVG 渲染，无第三方依赖。
 * 数据按时序（旧→新）传入；自适应坐标，末点高亮并标注分值。
 */
function TrendChart({ data }: { data: ScorePoint[] }) {
  const W = 360;
  const H = 150;
  const PAD_X = 12;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 26;
  const n = data.length;
  if (n === 0) return null;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 20;
  const y = (v: number) => PAD_TOP + (1 - (v - min) / span) * (H - PAD_TOP - PAD_BOTTOM);
  const x = (i: number) => (n === 1 ? W / 2 : PAD_X + (i / (n - 1)) * (W - PAD_X * 2));
  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`);
  const area = `M${x(0).toFixed(1)},${(H - PAD_BOTTOM).toFixed(1)} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${(H - PAD_BOTTOM).toFixed(1)} Z`;
  const last = data[n - 1];
  return (
    <div className="trend-chart" role="img" aria-label={`成绩走势：${data.map((d) => `${d.label} ${d.value}分`).join('，')}`}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet">
        {[min, min + span / 2, max].map((g, gi) => (
          <g key={gi}>
            <line x1={PAD_X} y1={y(g)} x2={W - PAD_X} y2={y(g)} className="trend-grid" />
            <text x={W - PAD_X} y={y(g) - 3} textAnchor="end" className="trend-axis">{Math.round(g)}</text>
          </g>
        ))}
        <path d={area} className="trend-area" />
        <polyline points={pts.join(' ')} className="trend-line" fill="none" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.value)} r={i === n - 1 ? 4.5 : 3.5} className={i === n - 1 ? 'trend-dot last' : 'trend-dot'} />
        ))}
        {data.map((d, i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="trend-xlabel">{d.label}</text>
        ))}
        <text x={x(n - 1)} y={y(last.value) - 10} textAnchor="middle" className="trend-point">{last.value}</text>
      </svg>
    </div>
  );
}

export function App() {
  const [page, setPage] = useState<NavKey>('home');
  const [text, setText] = useState('三年 Java 后端，负责订单与库存扣减改造，熟悉 Spring Boot、MySQL、Redis、消息队列。');
  const [role, setRole] = useState('Java 后端工程师');
  const [jd, setJd] = useState('');
  const [level, setLevel] = useState('中级');
  const [mode, setMode] = useState<'coach' | 'mock'>('coach');
  const [duration, setDuration] = useState<'15m' | '30m' | '45m'>('30m');
  const [keepAudio, setKeepAudio] = useState(() => localStorage.getItem('keepAudio') === '1');
  /** 录音保留默认值：设置页可切换并持久化，准备页 checkbox 同步该状态。 */
  const setKeepAudioDefault = (v: boolean) => { setKeepAudio(v); localStorage.setItem('keepAudio', v ? '1' : '0'); };
  /** 面试风格：设置页存默认（localStorage），准备页本场可调整。 */
  const [style, setStyle] = useState<'professional' | 'coaching' | 'concise'>(() => (localStorage.getItem('style') as 'professional' | 'coaching' | 'concise') || 'professional');
  const setStyleAndSave = (s: 'professional' | 'coaching' | 'concise') => { setStyle(s); localStorage.setItem('style', s); };
  const [resumeId, setResumeId] = useState<string>();
  /** 已选择的简历文件名（供上传控件反馈）。 */
  const [fileName, setFileName] = useState<string>();
  const [analysis, setAnalysis] = useState<string>();
  const [structured, setStructured] = useState<{ candidateName?: string; skills?: { name: string; level?: string }[]; experiences?: { company: string; role: string; period: string; bullets: string[] }[]; projects?: { name: string; role: string; stack: string[]; points: string[] }[] }>();
  const [interviewId, setInterviewId] = useState<string>();
  const [phase, setPhase] = useState<Phase>('intro');
  const [adjustNote, setAdjustNote] = useState<string>();
  const [dirs, setDirs] = useState<{ id: string; name: string; weight: number; reason?: string }[]>([]);
  const [selectedDirs, setSelectedDirs] = useState<string[]>([]);
  /** 用户通过「+」手动新增的自定义方向卡片，无限个；右上角 × 可删。 */
  const [customDirs, setCustomDirs] = useState<{ id: string; name: string }[]>([]);
  const customDirSeq = useRef(0);
  /** 「+ 新增方向」的就地输入态。 */
  const [addingDir, setAddingDir] = useState(false);
  const [dirDraft, setDirDraft] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [outlinePhases, setOutlinePhases] = useState<{ phase: string; minutes: number; questionCount: number; focus: string[] }[]>();
  const [outlineQuestions, setOutlineQuestions] = useState<{ topic: string; mainQuestion: string; difficulty?: string }[]>();
  const [turn, setTurn] = useState<RoomTurn>();
  const [phaseProgress, setPhaseProgress] = useState<Partial<Record<Phase, number>>>({});
  /** 自我介绍（陪练）后待确认的大纲调整建议。 */
  const [pendingAdjust, setPendingAdjust] = useState<{ type: string; after: string }[]>();
  /** 自我介绍（陪练）后依据要点/可追问点/矛盾点生成的分环节延伸追问（待确认）。 */
  const [pendingFollowups, setPendingFollowups] = useState<{ phase: string; question: string; reason?: string; kind?: string }[]>();
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [revising, setRevising] = useState(false);
  const [scoreHistory, setScoreHistory] = useState<{ stage: string; score: number; dims: { dim: string; displayScore?: number }[]; grade?: string }[]>([]);
  const [coaching, setCoaching] = useState<{ summary: string; structure: { point: string; explanation: string }[]; optimization?: { userPoint: string; improved: string; why: string }[]; note?: string; practice?: string }>();
  const [followUpCount, setFollowUpCount] = useState(0);
  const [startedAt, setStartedAt] = useState<string>();
  const [clock, setClock] = useState(Date.now());
  const [report, setReport] = useState<{ avgScore: number; grade: string; completed: number; coverage: string; usedMinutes?: number; dims: { dim: string; displayScore?: number }[]; actions: string[]; keepAudio?: boolean; highlight?: { best: { q?: string; why: string }; improve: { q?: string; why: string } } }>();
  const [review, setReview] = useState<{ id: string; parentId?: string; phase: string; question: string; transcript: string; score?: number; grade?: string; attempts: { stage?: string; transcript: string; score?: number; grade?: string; audioRef?: string; misconceptions?: { quote: string; clarification: string; kind?: 'knowledge' | 'asr' | 'assumption' }[] }[] }[]>([]);
  const [trend, setTrend] = useState<{ avgDelta: number; dims: { dim: string; delta: number }[] }>();
  const [resumeProgress, setResumeProgress] = useState<ResumeStreamProgress[]>([]);
  const [planProgress, setPlanProgress] = useState<PlanStreamProgress[]>([]);
  /** 作答评价的「大模型思考过程」：ASR 转写 + P07 评价 + P08 追问决策的模型原始输出。 */
  const [answerProgress, setAnswerProgress] = useState<AnswerStreamProgress[]>([]);
  const [error, setError] = useState<string>();
  /** 全局确认弹窗的状态；非空时显示居中弹窗。 */
  const [confirmState, setConfirmState] = useState<{ opts: ConfirmOptions; onConfirm: () => void }>();

  /** 弹出一个全局居中确认弹窗，返回 true（用户点确定）则执行指定动作。 */
  const askConfirm = (opts: ConfirmOptions, action: () => void) => setConfirmState({ opts, onConfirm: action });

  const run = <T,>(p: Promise<T>): Promise<T> => p.catch((e: unknown) => { setError(String((e as Error)?.message ?? e)); throw e; });

  const appendResumeProgress = (event: ResumeStreamProgress) => {
    setResumeProgress((previous) => {
      if (event.phase === 'delta' && previous.at(-1)?.phase === 'delta') {
        const last = previous.at(-1)!;
        return [...previous.slice(0, -1), { ...last, message: `${last.message}${event.message}`.slice(-6_000) }];
      }
      return [...previous, event].slice(-30);
    });
  };

  const appendPlanProgress = (event: PlanStreamProgress) => {
    setPlanProgress((previous) => {
      if (event.phase === 'delta' && previous.at(-1)?.phase === 'delta' && previous.at(-1)?.task === event.task) {
        const last = previous.at(-1)!;
        return [...previous.slice(0, -1), { ...last, message: `${last.message}${event.message}`.slice(-6_000) }];
      }
      return [...previous, event].slice(-45);
    });
  };

  /** 同一阶段（task）的模型增量文本合并到一条，避免逐 token 刷屏。 */
  const appendAnswerProgress = (event: AnswerStreamProgress) => {
    setAnswerProgress((previous) => {
      if (event.phase === 'delta' && previous.at(-1)?.phase === 'delta' && previous.at(-1)?.task === event.task) {
        const last = previous.at(-1)!;
        return [...previous.slice(0, -1), { ...last, message: `${last.message}${event.message}`.slice(-6_000) }];
      }
      return [...previous, event].slice(-45);
    });
  };

  /** 换到新题目后清空上一题的思考过程，避免与当前题目混淆（作答中 turn.id 不变，不会误清）。 */
  useEffect(() => { setAnswerProgress([]); }, [turn?.id]);

  /** 输入变化后，旧简历的分析不再对应当前文本，必须立即清除。 */
  const updateResumeText = (value: string) => {
    setText(value);
    setResumeId(undefined);
    setAnalysis(undefined);
    setStructured(undefined);
    setResumeProgress([]);
    setError(undefined);
  };

  /** 从面试 turns 汇总「回答转写回顾」：逐题保留各次作答（首次/复发并列，不以提示后最高分计入）。 */
  const buildReview = (turns: NonNullable<InterviewDetail['turns']>) =>
    turns
      .filter((t) => t.attempts.length > 0)
      .map((t) => {
        const attempts = t.attempts.map((a) => ({ stage: a.stage, transcript: a.transcript, score: a.evaluation?.score, grade: a.evaluation?.grade, audioRef: a.audioRef, misconceptions: a.evaluation?.misconceptions }));
        const last = attempts[attempts.length - 1];
        return { id: t.id, parentId: t.parentTurnId, phase: t.phase, question: t.question, attempts, transcript: last.transcript, score: last.score, grade: last.grade };
      });

  /** 把 P10 高亮的 turnRef 解析为题目文本（未命中时仅保留说明文字）。 */
  const resolveHighlight = (r: InterviewReport, turns: NonNullable<InterviewDetail['turns']>) =>
    r.highlight
      ? {
          best: { q: turns.find((t) => t.id === r.highlight!.bestAnswer.turnRef)?.question, why: r.highlight.bestAnswer.why },
          improve: { q: turns.find((t) => t.id === r.highlight!.improvementStart.turnRef)?.question, why: r.highlight.improvementStart.why },
        }
      : undefined;

  /** 抓取本场之前最近一场「同目标岗位」的已完成面试报告（用于横向对比；无上一场则返回 undefined）。 */
  const fetchPrevReport = async (curId: string, curRole?: string): Promise<InterviewReport | undefined> => {
    const items = (await api.listInterviews()).items;
    const prev = items
      .filter((h) => h.status === 'finished' && h.report && h.id !== curId && (!curRole || h.targetRole === curRole))
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return prev[0]?.report;
  };

  const parseResume = useMutation({
    mutationFn: async () => {
      if (modelQuery.data?.status.mode === 'mock') {
        throw new Error('请先在“设置 → 模型配置”中保存并测试真实大模型，再进行简历分析。');
      }
      setError(undefined);
      setResumeProgress([{ phase: 'requesting', message: '已连接解析服务，等待模型开始输出…' }]);
      const r = await run(api.createResumeStream(text, appendResumeProgress));
      setResumeId(r.resume.id);
      setAnalysis(r.resume.analysis.summary);
      setStructured(r.resume.analysis);
      // 换新简历 → 清零与本场/上一场相关的会话状态，避免方向/阶段透传。
      setInterviewId(undefined);
      setPhase('intro');
      setTurn(undefined);
      setPhaseProgress({});
      setPendingAdjust(undefined); setPendingFollowups(undefined);
      setReport(undefined);
      setTrend(undefined);
      setReview([]);
      setCoaching(undefined);
      setTopics([]);
      setOutlinePhases(undefined);
      setOutlineQuestions(undefined);
      setSelectedDirs([]);
      setDirs([]);
      setCustomDirs([]);
      setAdjustNote(undefined);
      setStartedAt(undefined);
      savedResumesQuery.refetch();
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
    setFileName(f.name);
    reader.onload = () => updateResumeText(String(reader.result ?? ''));
    reader.readAsText(f);
  };

  const bootstrap = useMutation({
    mutationFn: async () => {
      if (!resumeId) throw new Error('请先导入简历');
      const interview = await run(api.createInterview(resumeId, {
        kind: mode,
        keepAudio,
        jdText: jd || undefined,
        role,
        level: ({ 初级: 'junior', 中级: 'mid', 高级: 'senior' } as Record<string, 'junior' | 'mid' | 'senior'>)[level],
        durationTier: duration,
        style,
      }));
      setPlanProgress([]);
      const plan = await run(api.createPlanStream(interview.interview.id, appendPlanProgress));
      setDirs(plan.recommendedDirections.recommendedDirections);
      setSelectedDirs(plan.recommendedDirections.recommendedDirections.map((x) => x.id));
      setInterviewId(interview.interview.id);
      setError(undefined);
    },
  });

  /** 提交就地新增方向卡片（空名称视为取消）；成功后默认选中并回到「+」态。 */
  const addCustomDir = () => {
    const name = dirDraft.trim();
    setAddingDir(false);
    setDirDraft('');
    if (!name) return;
    const id = `custom:${++customDirSeq.current}`;
    setCustomDirs((cs) => [...cs, { id, name }]);
    setSelectedDirs((s) => (s.includes(id) ? s : [...s, id]));
  };

  /** 删除一张自定义方向卡片（同时从已选集合移除）。 */
  const removeCustomDir = (id: string) => {
    setCustomDirs((cs) => cs.filter((c) => c.id !== id));
    setSelectedDirs((s) => s.filter((x) => x !== id));
  };

  /** 按已选方向重新推荐 + 生成大纲（不立即开考，供先预览流程/题目）。 */
  const generatePlan = useMutation({
    mutationFn: async () => {
      setPlanProgress([]);
      // 从只创建了计划记录的中断点恢复时，先补齐/复用 P02、P03，再让用户选择方向；不能跳过岗位分析直出大纲。
      if (dirs.length === 0) {
        const plan = await run(api.createPlanStream(interviewId!, appendPlanProgress));
        setDirs(plan.recommendedDirections.recommendedDirections);
        setSelectedDirs(plan.recommendedDirections.recommendedDirections.map((direction) => direction.id));
        setError(undefined);
        return;
      }
      // 内置方向用 id 交给后端；自定义方向把名称拼入 extra，使其参与本次大纲生成。
      const builtInSelected = selectedDirs.filter((id) => dirs.some((d) => d.id === id));
      const customNames = customDirs.filter((c) => selectedDirs.includes(c.id)).map((c) => c.name).join('、');
      const plan = await run(api.createOutlineStream(interviewId!, builtInSelected.length ? builtInSelected : undefined, customNames || undefined, appendPlanProgress));
      setDirs(plan.recommendedDirections.recommendedDirections);
      const outline = plan.outline!;
      setTopics(outline.outline.map((q) => q.topic));
      setOutlinePhases(outline.durationPlan?.phases);
      setOutlineQuestions(outline.outline);
      setError(undefined);
    },
  });

  /** 预览确认后正式开考：start（记开始时间）→ 出第一题进面试室。 */
  const startInterview = useMutation({
    mutationFn: async () => {
      const st = await run(api.start(interviewId!));
      setStartedAt(st.interview.startedAt);
      setError(undefined);
      await beginTurn.mutateAsync();
    },
  });

  const beginTurn = useMutation({
    mutationFn: async (requestedPhase?: Phase) => {
      // 不依赖 setPhase 的异步状态更新，保证“下一环节”实际向服务端请求的是下一环节的题。
      const turnPhase = requestedPhase ?? phase;
      const res = await run(api.newTurn(interviewId!, turnPhase));
      setDraft('');
      setScoreHistory([]);
      setCoaching(undefined);
      setRevising(false);
      reanswerStartRef.current = undefined;
      setPendingAdjust(undefined); setPendingFollowups(undefined);
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
      setPendingAdjust(undefined); setPendingFollowups(undefined);
      setRecording(false);
      setFollowUpCount((c) => c + 1);
      setTurn({ id: res.turn.id, question: res.turn.question, phase: res.turn.phase as Phase, topic: res.turn.topic, difficulty: res.turn.difficulty, targetAspect: res.turn.targetAspect, followup: true });
    },
  });

  /** 本环节计划题数（来自大纲；无计划时不提示）。 */
  const plannedOf = (p: Phase) => outlinePhases?.find((x) => x.phase === p)?.questionCount;

  /**
   * 是否已到「本场最后一题」——决定是否展示「完成面试，查看报告」入口。
   * 判定：位于最后环节（hr）+ 本环节计划题数已答满；无大纲计划时视为已答满（兜底，避免收尾入口永不出现）。
   * 追问轮不占用主问题计数，故不算收尾点。
   */
  const isLastQuestion = (() => {
    if (!turn?.answered || turn.followup) return false;
    if (phase !== PHASES[PHASES.length - 1]) return false;
    const planned = plannedOf(phase);
    return !planned || (phaseProgress[phase] ?? 0) >= planned;
  })();

  /** 结束面试：本环节未答满计划题数时先确认，避免误提交过早报告。 */
  const goFinish = () => {
    const planned = plannedOf(phase);
    const done = phaseProgress[phase] ?? 0;
    if (planned && done < planned) {
      askConfirm({ title: '结束面试', message: `本环节计划 ${planned} 题，目前已答 ${done}。确定结束面试生成报告吗？`, confirmText: '结束面试', cancelText: '继续练习' }, () => finish.mutate());
      return;
    }
    finish.mutate();
  };

  /** 推进到下一环节（含自我介绍后的大纲调整触发）；hr 之后结束。 */
  const advancePhase = async () => {
    const planned = plannedOf(phase);
    const done = phaseProgress[phase] ?? 0;
    if (planned && done < planned) {
      askConfirm({ title: '进入下一环节', message: `本环节计划 ${planned} 题，目前已答 ${done}。确定进入下一环节吗？`, confirmText: '进入下一环节', cancelText: '继续作答' }, () => advanceNow());
      return;
    }
    await advanceNow();
  };

  const advanceNow = async () => {
    const idx = PHASES.indexOf(phase);
    if (phase === 'intro' && mode === 'mock') {
      try {
        await run(api.adjustOutline(interviewId!, 'apply'));
        setAdjustNote('自我介绍后：已按新线索自动更新后续大纲。');
      } catch {
        setAdjustNote('自我介绍后：大纲自动更新失败（可继续）。');
      }
    }
    const next = PHASES[idx + 1];
    if (!next) { goFinish(); return; }
    setPhase(next);
    await beginTurn.mutateAsync(next);
  };

  /** 答完一题向前推进；自我介绍（陪练）先生成大纲调整供确认，不直接推进。 */
  const advance = () => {
    if (phase === 'intro' && mode === 'coach') {
      run(api.adjustOutline(interviewId!, 'preview'))
        .then((adj) => { setPendingAdjust(adj.adjustment?.changes ?? []); setPendingFollowups(adj.adjustment?.followups ?? []); })
        .catch(() => setPendingAdjust([]));
      return;
    }
    void advancePhase();
  };

  /** 确认应用大纲调整后进入下一环节；模拟模式自动应用即此语义。 */
  const applyAdjustAndAdvance = () => {
    api.adjustOutline(interviewId!, 'apply')
      .then(async () => {
        setPendingAdjust(undefined); setPendingFollowups(undefined);
        setAdjustNote('已按确认应用自我介绍后的大纲调整与延伸追问。');
        await advancePhase();
      })
      .catch(() => setAdjustNote('自我介绍后：大纲调整应用失败，请重试确认或跳过。'));
  };

  /** 跳过自我介绍后的大纲调整，直接进入下一环节。 */
  const skipAdjustAndAdvance = () => {
    api.adjustOutline(interviewId!, 'discard')
      .then(async () => {
        setPendingAdjust(undefined); setPendingFollowups(undefined);
        await advancePhase();
      })
      .catch(() => setAdjustNote('自我介绍后的调整尚未跳过，请重试。'));
  };

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /** 点击「重新回答」的时刻，用于统计反馈阅读 / 重答耗时。 */
  const reanswerStartRef = useRef<number | undefined>(undefined);

  const startRec = async () => {
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
      setRecording(true);
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
      stopRecording();
      const stage = payload.stage ?? (revising ? 'after_hint' : 'first');
      const transcript = payload.transcript ?? draft;
      // 走 SSE 版本：边评价边把模型原始输出推给「大模型思考过程」面板；落库与返回结构同非流式端点。
      setAnswerProgress([]);
      const answered = await run(api.answerStream(
        interviewId!,
        turn!.id,
        payload.audioRef ? { audioRef: payload.audioRef, stage } : { transcript, stage },
        appendAnswerProgress,
      ));
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
      setPendingAdjust(undefined); setPendingFollowups(undefined);
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

  /** 停止录音器并释放麦克风流（MediaRecorder 持有的 stream tracks），避免录音结束后麦克风仍占用。 */
  const stopRecording = () => {
    const rec = mediaRef.current;
    mediaRef.current = null;
    if (!rec) return;
    try {
      if (rec.state !== 'inactive') rec.stop();
      rec.stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* 停止异常忽略，不阻塞主流程 */
    }
  };

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
        stopRecording();
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
        usedMinutes: res.report.overview.durationUsedMinutes,
        dims,
        actions: res.report.actionPlan.map((a) => `${a.area}：${a.suggestion}${a.practiceSuggestion ? `（练习：${a.practiceSuggestion}）` : ''}`),
        keepAudio: detail.interview.keepAudio,
        highlight: resolveHighlight(res.report, detail.interview.turns ?? []),
      });
      const prev = await fetchPrevReport(interviewId!, role);
      setTrend(prev ? buildTrend(prev, res.report.overview.avgScore, dims) : undefined);
      setInterviewId(undefined);
      setTurn(undefined);
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
    const sub = `本场共 ${report.completed} 题，方向覆盖 ${report.coverage}${report.usedMinutes !== undefined ? `，实际用时 ${report.usedMinutes} 分钟` : ''}；${highest ? `「${highest.dim}」表现较稳` : '整体较为平均'}。${trendNote}建议聚焦行动清单前几项，补足适用前提、失败处理与验证结果。`;
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
          {a.audioRef && (
            <audio controls preload="none" src={audioSrc(a.audioRef)} style={{ width: '100%', height: 34, marginTop: 6 }} aria-label="回听本段作答录音">
              你的浏览器不支持音频回放。
            </audio>
          )}
          {it.attempts.length > 1 && (
            <small>{a.stage === 'after_hint' ? '复读作答' : '首次作答'} · {a.score !== undefined ? `${a.score} 分` : '仅记录'}</small>
          )}
          {a.misconceptions?.map((m, k) => (
            <div key={k} style={{ marginTop: 6 }}>
              <span className="tag amber" style={{ marginRight: 6 }}>{({ knowledge: '知识误区', asr: '转写误识', assumption: '前提假设' } as Record<string, string>)[m.kind ?? 'knowledge']}</span>
              <p className="quote" style={{ marginTop: 4 }}>「{m.quote}」→ {m.clarification}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
  /** 把当前复盘报告导出为 Markdown（含维度、行动项、逐题转写）。 */
  const exportReport = () => {
    if (!report) return;
    const L: string[] = [];
    L.push(`# 复盘报告 · ${role}（${level}）`);
    L.push(`综合表现：${report.avgScore} / 100 · ${report.grade}`);
    L.push(`作答 ${report.completed} 题 · 方向覆盖 ${report.coverage}${report.usedMinutes !== undefined ? ` · 实际用时 ${report.usedMinutes} 分钟` : ''}`);
    L.push('');
    L.push(`## 八维表现`);
    report.dims.forEach((d) => L.push(`- ${d.dim}：${d.displayScore ?? '—'}`));
    if (trend && (trend.dims.length > 0 || trend.avgDelta !== 0)) {
      L.push('');
      L.push(`## vs 上一场`);
      L.push(`- 综合表现：${trend.avgDelta >= 0 ? '▲ +' : '▼ '}${Math.abs(trend.avgDelta)}`);
      trend.dims.forEach((d) => L.push(`- ${d.dim}：${d.delta >= 0 ? '▲ +' : '▼ '}${Math.abs(d.delta)}`));
    }
    if (report.highlight) {
      L.push('');
      L.push(`## 本场最佳 & 最需改进`);
      L.push(`- 最佳作答：${report.highlight.best.q ?? '—'}（${report.highlight.best.why}）`);
      L.push(`- 最需改进：${report.highlight.improve.q ?? '—'}（${report.highlight.improve.why}）`);
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
          it.attempts.forEach((a) => {
            if (a.transcript) L.push(`  - ${a.transcript}`);
            (a.misconceptions ?? []).forEach((m) => L.push(`    - ⚠ ${m.kind === 'asr' ? '转写误识' : m.kind === 'assumption' ? '前提假设' : '知识误区'}：「${m.quote}」→ ${m.clarification}`));
          });
          for (const k of children.filter((c) => c.parentId === it.id)) {
            L.push(`  - 追问：${k.question}${k.score !== undefined ? `（${k.score} 分）` : ''}`);
            k.attempts.forEach((a) => {
              if (a.transcript) L.push(`    - ${a.transcript}`);
              (a.misconceptions ?? []).forEach((m) => L.push(`      - ⚠ ${m.kind === 'asr' ? '转写误识' : m.kind === 'assumption' ? '前提假设' : '知识误区'}：「${m.quote}」→ ${m.clarification}`));
            });
          }
        }
      }
    }
    const blob = new Blob([L.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeRole = (role || '面试').replace(/[\\/:*?"<>|]/g, '_');
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    a.download = `AI面试小助理-${dateStr}-${safeRole}-${report.avgScore}分.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- 工作台：历史报告 ----
  const [histFilter, setHistFilter] = useState<'all' | 'active' | 'finished'>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [modeFilter, setModeFilter] = useState<'all' | 'coach' | 'mock'>('all');
  // 工作台汇总所有场次；练习室和报告页只作为“选择一条已保存记录后继续”的入口。
  const histQuery = useQuery({ queryKey: ['interviews'], queryFn: api.listInterviews, enabled: page === 'home' || page === 'room' || page === 'report' });
  const history = histQuery.data?.items ?? [];
  const roles = uniqueRoles(history);
  /** 目标岗位缩范围（岗位被删光时回落到「全部」，避免空列表）。 */
  const effectiveRole = roleFilter !== 'all' && !roles.includes(roleFilter) ? 'all' : roleFilter;
  /** 按目标岗位缩范围后的场次（「全部」为 all）。 */
  const scoped = filterByRole(history, effectiveRole).filter((h) => modeFilter === 'all' || h.kind === modeFilter);
  const filteredHistory = scoped.filter((h) => (histFilter === 'active' ? h.status !== 'finished' : histFilter === 'finished' ? h.status === 'finished' : true));
  const finCount = scoped.filter((h) => h.status === 'finished').length;
  const avgFinished = (() => {
    const scores = scoped.filter((h) => h.status === 'finished' && h.report).map((h) => h.report!.overview.avgScore);
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  })();
  /** 最近几场综合分（旧→新，按当前岗位范围），用于工作台「成绩走势」。 */
  const scores = recentScores(scoped.filter((h) => h.status === 'finished'), 5);
  /** 已完成场次的报告（按当前岗位范围），用于「平均八维」。 */
  const finishedReports = scoped.filter((h) => h.status === 'finished' && h.report);
  const avgDim = avgDims(finishedReports.map((h) => h.report!));
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
        usedMinutes: r.overview.durationUsedMinutes,
        dims,
        actions: (r.actionPlan ?? []).map((a) => `${a.area}：${a.suggestion}${a.practiceSuggestion ? `（练习：${a.practiceSuggestion}）` : ''}`),
        keepAudio: detail.interview.keepAudio,
        highlight: resolveHighlight(r, detail.interview.turns ?? []),
      });
      const prev = await fetchPrevReport(id, detail.interview.targetRole);
      setTrend(prev ? buildTrend(prev, r.overview.avgScore, dims) : undefined);
      setInterviewId(undefined);
      setTurn(undefined);
      setPage('report');
    },
    onSuccess: () => histQuery.refetch(),
  });

  /** 从已保存的准备草稿恢复。已有 P02/P03/P04 结果直接复用，避免重复生成或另起一场。 */
  const resumePreparation = useMutation({
    mutationFn: async (id: string) => {
      const detail = await run(api.getInterview(id));
      if (detail.interview.status !== 'draft') throw new Error('只有尚未开始的面试计划可以继续准备');
      const interview = detail.interview;
      setResumeId(interview.resumeId);
      setRole(interview.targetRole);
      setJd(interview.jdText ?? '');
      setMode(interview.kind);
      setLevel(interview.level === 'senior' ? '高级' : interview.level === 'junior' ? '初级' : '中级');
      setDuration(interview.durationTier as '15m' | '30m' | '45m');
      if (interview.style) setStyle(interview.style);
      setKeepAudio(!!interview.keepAudio);
      setInterviewId(interview.id);
      setDirs(interview.directionsResult?.recommendedDirections ?? []);
      setSelectedDirs(interview.directions ?? []);
      setTopics(interview.outline?.outline?.map((q) => q.topic) ?? []);
      setOutlinePhases(interview.outline?.durationPlan?.phases);
      setOutlineQuestions(interview.outline?.outline);
      setCustomDirs([]);
      setPlanProgress([]);
      setError(undefined);
      setPage('prepare');
    },
    onSuccess: () => histQuery.refetch(),
  });

  /** 中途离开后继续进行中的面试：恢复现场并继续本环节下一题。 */
  const resumeInterview = useMutation({
    mutationFn: async (id: string) => {
      const detail = await run(api.getInterview(id));
      if (detail.interview.status !== 'active') throw new Error('该场不在进行中');
      const turns = detail.interview.turns ?? [];
      // 按已有轮次重建各环节已答主问题数（追问轮不计）。
      const progress: Partial<Record<Phase, number>> = {};
      for (const t of turns) {
        if (!t.parentTurnId) progress[t.phase as Phase] = (progress[t.phase as Phase] ?? 0) + 1;
      }
      setPhaseProgress(progress);
      // 还原大纲与题目元信息，使环节计划题数提示/防早收确认在恢复后仍生效（页面刷新后原状态丢失）。
      setOutlinePhases(detail.interview.outline?.durationPlan?.phases);
      setOutlineQuestions(detail.interview.outline?.outline);
      setTopics(detail.interview.outline?.outline?.map((q) => q.topic) ?? []);
      setInterviewId(id);
      setStartedAt(detail.interview.startedAt);
      setMode(detail.interview.kind);
      setLevel(detail.interview.level === 'senior' ? '高级' : detail.interview.level === 'junior' ? '初级' : '中级');
      setDraft('');
      setScoreHistory([]);
      setCoaching(undefined);
      setRevising(false);
      reanswerStartRef.current = undefined;
      const pending = detail.interview.pendingAdjustment;
      setPendingAdjust(pending ? pending.changes ?? [] : undefined);
      setPendingFollowups(pending?.followups ?? undefined);
      setRecording(false);
      setFollowUpCount(0);

      const lastTurn = turns[turns.length - 1];
      // 陪练的 P05 预览已持久化但尚未确认：恢复到确认界面，不重新提问或重新生成建议。
      if (pending) {
        setPhase('intro');
        setTurn(undefined);
        setAdjustNote('已恢复自我介绍后的待确认调整。');
        setPage('room');
        return;
      }
      // 上次离开前最后一题尚未作答：直接回到该题，不要派生新题（避免自我介绍阶段反复刷出进阶题）。
      if (lastTurn && (lastTurn.attempts?.length ?? 0) === 0) {
        setPhase(lastTurn.phase as Phase);
        setAdjustNote('已从上次进度继续，直接回到该题。');
        setTurn({ id: lastTurn.id, question: lastTurn.question, phase: lastTurn.phase as Phase, topic: lastTurn.topic, difficulty: lastTurn.difficulty, targetAspect: lastTurn.targetAspect, followup: false });
        setPage('room');
        return;
      }
      // 正常恢复：定位到「首个计划题数尚未答满」的环节，再生成该环节下一题。
      const plannedOf = (p: Phase) => detail.interview.outline?.durationPlan?.phases?.find((x) => x.phase === p)?.questionCount;
      let resumePhase: Phase = 'intro';
      for (const p of PHASES) {
        // P04 可以不单列 intro，但每场仍只进行一次开场自我介绍；恢复时不能再生成它。
        if (p === 'intro' && turns.some((t) => t.phase === 'intro' && t.attempts.length > 0)) continue;
        const pl = plannedOf(p);
        if (pl === undefined || (progress[p] ?? 0) < pl) { resumePhase = p; break; }
      }
      setPhase(resumePhase);
      const res = await run(api.newTurn(id, resumePhase));
      setTurn({ id: res.turn.id, question: res.turn.question, phase: res.turn.phase as Phase, topic: res.turn.topic, difficulty: res.turn.difficulty, targetAspect: res.turn.targetAspect, followup: false });
      setAdjustNote('已从上次进度继续，这是本环节下一题。');
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
  const modelQuery = useQuery({ queryKey: ['modelSettings'], queryFn: api.getModelSettings, enabled: page === 'settings' || page === 'resume' });
  const savedResumesQuery = useQuery({ queryKey: ['savedResumes'], queryFn: api.listResumes, enabled: page === 'resume' });
  /** 当前选中简历的名称：优先取已保存简历标题，回退到本地上传文件名。 */
  const currentResumeName = useMemo(() => {
    if (!resumeId) return undefined;
    const saved = savedResumesQuery.data?.items?.find((r) => r.id === resumeId);
    if (saved?.title) return saved.title;
    if (fileName?.startsWith('已保存 · ')) return fileName.slice(5);
    return fileName;
  }, [resumeId, savedResumesQuery.data, fileName]);
  const [renamingResumeId, setRenamingResumeId] = useState<string>();
  const [resumeTitleDraft, setResumeTitleDraft] = useState('');
  const renameSubmittingRef = useRef<string | undefined>(undefined);
  const loadSavedResume = useMutation({
    mutationFn: async (id: string) => {
      const { resume } = await run(api.getResume(id));
      if (!resume.analysis) throw new Error('该简历尚未完成分析，无法复用');
      setText(resume.text);
      setFileName(`已保存 · ${resume.title}`);
      setResumeId(resume.id);
      setAnalysis(resume.analysis.summary);
      setStructured(resume.analysis);
      setResumeProgress([{ phase: 'complete', message: '已载入已保存的 AI 分析，本次未调用模型。' }]);
      setInterviewId(undefined);
      setPhase('intro');
      setTurn(undefined);
      setPhaseProgress({});
      setPendingAdjust(undefined); setPendingFollowups(undefined);
      setReport(undefined);
      setTrend(undefined);
      setReview([]);
      setCoaching(undefined);
      setTopics([]);
      setOutlinePhases(undefined);
      setOutlineQuestions(undefined);
      setSelectedDirs([]);
      setDirs([]);
      setCustomDirs([]);
      setAdjustNote(undefined);
      setStartedAt(undefined);
      setError(undefined);
    },
  });
  const deleteSavedResume = useMutation({
    mutationFn: async (id: string) => {
      await run(api.deleteResume(id));
      if (resumeId === id) updateResumeText('');
      await savedResumesQuery.refetch();
    },
  });
  const renameSavedResume = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const normalized = title.trim();
      if (!normalized) throw new Error('简历名称不能为空');
      const { resume } = await run(api.renameResume(id, normalized));
      if (resumeId === id) setFileName(`已保存 · ${resume.title}`);
      setRenamingResumeId(undefined);
      await savedResumesQuery.refetch();
    },
  });
  const commitResumeRename = (id: string, title: string) => {
    if (renameSubmittingRef.current === id) return;
    renameSubmittingRef.current = id;
    renameSavedResume.mutate({ id, title }, { onSettled: () => { renameSubmittingRef.current = undefined; } });
  };
  const [cfgMode, setCfgMode] = useState<{ baseUrl: string; model: string; apiKey: string; mode: 'platform' | 'custom' }>({ baseUrl: '', model: '', apiKey: '', mode: 'custom' });
  useEffect(() => {
    const s = modelQuery.data?.status;
    if (s) setCfgMode((c) => ({ ...c, baseUrl: s.baseUrl ?? c.baseUrl, model: s.model ?? c.model }));
  }, [modelQuery.data?.status?.model, modelQuery.data?.status?.baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveModel = useMutation({
    mutationFn: async () => {
      setSaveOk(false);
      await api.setModelConfig({ mode: cfgMode.mode, baseUrl: cfgMode.baseUrl, model: cfgMode.model, apiKey: cfgMode.apiKey || undefined });
      modelQuery.refetch();
      setSaveOk(true);
    },
  });
  const [saveOk, setSaveOk] = useState(false);
  const applyPreset = (p: { baseUrl: string; model: string }) => setCfgMode((c) => ({ ...c, baseUrl: p.baseUrl, model: p.model, mode: 'custom' }));
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number; error?: string }>();
  const testModel = useMutation({
    mutationFn: async () => {
      // 测试当前选中的配置（custom 用表单候选，不切换运行态）；失败经 run 上浮可读错误。
      setTestResult(undefined);
      const r = await run(api.testModel({ mode: cfgMode.mode, baseUrl: cfgMode.baseUrl, model: cfgMode.model, apiKey: cfgMode.apiKey || undefined }));
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
  // 离开页面/卸载时释放仍在录音的麦克风。
  useEffect(() => () => stopRecording(), []);
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
  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      await api.deleteTemplate(id);
      if (selId === id) setSelId(undefined);
      refreshAdmin();
    },
  });

  return (
    <div id="viewport">
      <div id="app">
        <div className="shell">
          <aside className="sidebar">
            <div className="logo"><span className="logo-mark"><BrandMark /></span><span>AI面试小助理</span></div>
            <nav className="nav">
              {nav.map((n) => (
                <button key={n.k} className={active === n.k ? 'active' : ''} onClick={() => setPage(n.k)}>
                  <span className="navicon"><Icon name={n.icon} /></span>{n.label}
                </button>
              ))}
            </nav>
            <div className="sidebar-foot">
              <span className="avatar">求</span><span><b>求职者</b></span>
            </div>
          </aside>

          <div className="main">
            <header className="topbar">
              <div className="breadcrumb"><strong>{titles[active]}</strong></div>
              <div className="row">
                {active === 'room' && <span className="tag blue">{mode === 'coach' ? '陪练模式' : '模拟面试'}</span>}
                {active === 'report' && <span className="tag amber">复盘报告</span>}
                {active === 'prepare' && resumeId && <span className="tag blue" title="本次练习所用简历">当前简历 · {currentResumeName ?? '已选择'}</span>}
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
                    <section className="card"><small>已练习场次</small><div className="metric">{scoped.length}<span>场</span></div></section>
                    <section className="card"><small>已完成</small><div className="metric">{finCount}<span>场</span></div></section>
                    <section className="card"><small>平均表现</small><div className="metric">{avgFinished ? `${avgFinished}分` : '—'}<span>{avgFinished ? gradeOf(avgFinished) : '暂无'}</span></div></section>
                  </div>

                  {scores.length > 0 && (
                    <section className="card" style={{ marginTop: 18 }}>
                      <div className="row between" style={{ marginBottom: 10 }}>
                        <h3 style={{ margin: 0 }}>成绩走势</h3>
                        {scores.length >= 2 && (() => { const d = scores[scores.length - 1].value - scores[0].value; return <span className={`tag ${d > 0 ? 'green' : d < 0 ? 'amber' : ''}`}>{d >= 0 ? '▲' : '▼'} 首尾 {Math.abs(d)} 分</span>; })()}
                      </div>
                      <div className="trend-chart"><TrendChart data={scores} /></div>
                    </section>
                  )}

                  {avgDim.length > 0 && (
                    <section className="card" style={{ marginTop: 18 }}>
                      <div className="row between" style={{ marginBottom: 10 }}>
                        <h3 style={{ margin: 0 }}>平均八维</h3>
                        <span className="tag blue">{finishedReports.length} 场平均</span>
                      </div>
                      <div className="dimension-grid">
                        {avgDim.map((d) => (
                          <div className="score-row" key={d.dim}><span style={{ minWidth: 100 }}>{d.dim}</span><span className="bar"><i style={{ width: `${d.displayScore}%` }} /></span><b>{d.displayScore}</b></div>
                        ))}
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
                          {([['all', '全部'], ['coach', '陪练'], ['mock', '模拟']] as const).map(([k, label]) => (
                            <button key={k} aria-pressed={modeFilter === k} onClick={() => setModeFilter(k)} style={{ padding: '5px 10px', fontSize: 12 }}>{label}</button>
                          ))}
                          {([['all', '全部'], ['active', '进行中'], ['finished', '已完成']] as const).map(([k, label]) => (
                            <button key={k} aria-pressed={histFilter === k} onClick={() => setHistFilter(k)} style={{ padding: '5px 10px', fontSize: 12 }}>{label}</button>
                          ))}
                        </div>
                      </div>
                      {filteredHistory.map((h) => (
                        <div className="list-row" key={h.id}>
                          <div>
                            <b>{h.targetRole} · {h.level === 'mid' ? '中级' : h.level === 'junior' ? '初级' : '高级'}</b>
                            <p>{h.kind === 'coach' ? '陪练' : '模拟'} · {h.status === 'finished' ? `报告 ${h.report?.overview.avgScore} 分 · 完成 ${h.report?.overview.completedAnswers} 题` : h.status === 'active' ? `进行中${h.currentPhase ? ` · ${phaseLabel[h.currentPhase]}` : ''}` : '草稿'} · {new Date(h.updatedAt).toLocaleString()}</p>
                          </div>
                          <div className="row" style={{ gap: 6 }}>
                            {h.status === 'finished' ? (
                              <button onClick={() => openHistory.mutate(h.id)} disabled={openHistory.isPending}>查看报告</button>
                            ) : h.status === 'active' ? (
                              <button onClick={() => resumeInterview.mutate(h.id)} disabled={resumeInterview.isPending}>{resumeInterview.isPending ? '继续中…' : '继续'}</button>
                            ) : (
                              <button onClick={() => resumePreparation.mutate(h.id)} disabled={resumePreparation.isPending}>{resumePreparation.isPending ? '载入中…' : '继续准备'}</button>
                            )}
                            <button className="danger ghost" onClick={() => askConfirm({ danger: true, title: '删除面试记录', message: '删除这场面试记录？删除后不可恢复。', confirmText: '删除', cancelText: '保留' }, () => deleteInterview.mutate(h.id))} disabled={deleteInterview.isPending}>删除</button>
                          </div>
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
                    {(savedResumesQuery.data?.items.length ?? 0) > 0 && (
                      <section className="saved-resumes" aria-label="已保存简历">
                        <div className="row between"><b>已保存的简历</b><small>选择后直接复用 AI 分析，不会重新调用模型</small></div>
                        <div className="saved-resume-list">
                          {savedResumesQuery.data!.items.map((saved) => (
                            <div className={`saved-resume-row ${resumeId === saved.id ? 'active' : ''}`} key={saved.id}>
                              <div className="saved-resume-content">
                                {renamingResumeId === saved.id ? (
                                  <input
                                    className="saved-resume-title-input"
                                    autoFocus
                                    value={resumeTitleDraft}
                                    maxLength={80}
                                    aria-label="简历名称"
                                    onChange={(e) => setResumeTitleDraft(e.target.value)}
                                    onBlur={() => commitResumeRename(saved.id, resumeTitleDraft)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitResumeRename(saved.id, resumeTitleDraft); } if (e.key === 'Escape') setRenamingResumeId(undefined); }}
                                  />
                                ) : <b className="saved-resume-title" title="双击重命名" onDoubleClick={() => { setRenamingResumeId(saved.id); setResumeTitleDraft(saved.title); }}>{saved.title}</b>}
                                <small>{saved.analysis?.summary ?? '已保存'} · {new Date(saved.createdAt).toLocaleString()}</small>
                              </div>
                              <div className="saved-resume-actions">
                                <button className="saved-resume-action use" onClick={() => loadSavedResume.mutate(saved.id)} disabled={loadSavedResume.isPending}>{loadSavedResume.isPending ? '载入中' : '使用'}</button>
                                <button className="saved-resume-action delete" onClick={() => askConfirm({ danger: true, title: '删除简历', message: `删除已保存简历“${saved.title}”？删除后不可恢复。`, confirmText: '删除', cancelText: '保留' }, () => deleteSavedResume.mutate(saved.id))} disabled={deleteSavedResume.isPending}>删除</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    <div className="dropzone">
                      <div className="upload-icon">↥</div>
                      <h3>粘贴简历内容 或 上传 .md/.txt</h3>
                      <p>PDF、DOCX、Markdown、TXT（MVP 读取 .md/.txt，其余请粘贴）</p>
                      <textarea data-field="resumeText" value={text} onChange={(e) => updateResumeText(e.target.value)} rows={6} placeholder="粘贴你的项目经历、技术栈与工作经历…" />
                      <div className="row" style={{ marginTop: 14, justifyContent: 'center' }}>
                        <label className="file-picker">
                          <input type="file" accept=".md,.txt,.pdf,.docx" onChange={pickResumeFile} aria-label="选择简历文件" />
                          <span className="file-picker-btn">选择文件</span>
                          <span className="file-picker-name">{fileName ?? '拖拽或点击选择 .md / .txt'}</span>
                        </label>
                      </div>
                    </div>
                    <div className="actions">
                      <button className="primary" onClick={() => parseResume.mutate()} disabled={parseResume.isPending || modelQuery.isLoading || modelQuery.data?.status.mode === 'mock'}>
                        {parseResume.isPending ? '正在流式解析…' : 'AI分析 →'}
                      </button>
                    </div>
                    {modelQuery.data?.status.mode === 'mock' && (
                      <div className="notice" style={{ marginTop: 14, background: '#fff7e8', color: '#9a5a05' }}>
                        当前尚未配置真实大模型，无法执行简历分析。<button className="ghost" onClick={() => setPage('settings')}>前往模型配置 →</button>
                      </div>
                    )}
                    {(parseResume.isPending || resumeProgress.length > 0) && (
                      <section className="stream-panel" aria-live="polite">
                        <div className="row between">
                          <div><b>解析实时进度</b><small> 模型原始输出与结构校验状态</small></div>
                          <span className={`tag ${parseResume.isPending ? 'blue' : 'green'}`}>{parseResume.isPending ? '处理中' : '已结束'}</span>
                        </div>
                        <div className="stream-log">
                          {resumeProgress.map((event, index) => (
                            <div className={`stream-event ${event.phase}`} key={`${event.phase}-${index}`}>
                              <span>{({ requesting: '请求', validating: '校验', retrying: '重试', complete: '完成', delta: '模型' } as Record<string, string>)[event.phase]}</span>
                              <pre>{event.message}</pre>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </section>
                  <section className="card">
                    <div className="row between"><h2>确认分析结果</h2><div className="row" style={{ gap: 6 }}><span className="tag ai">AI 生成</span><span className={`tag ${structured ? 'blue' : modelQuery.data?.status.mode === 'mock' ? '' : 'blue'}`}>{structured ? '待你确认' : modelQuery.data?.status.mode === 'mock' ? '需配置模型' : '等待分析'}</span></div></div>
                    <div className="profile-summary"><span className="eyebrow">候选人概况</span><strong>{analysis ?? '尚未完成分析'}</strong></div>
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
                    ) : <div className="resume-block"><p>配置真实模型后提交简历，右侧将仅展示本次模型解析出的经历、项目与技能。</p></div>}
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
                          {!resumeId && (
                            <div className="notice amber" style={{ marginBottom: 12 }}>还没有可用简历：请先在「我的简历」导入并确认，再回来生成面试计划。</div>
                          )}
                          <h3>先告诉我这次的目标岗位。</h3>
                          <div className="fields">
                            <label className="field">目标岗位<input type="text" value={role} onChange={(e) => setRole(e.target.value)} /></label>
                            <label className="field">目标级别<select value={level} onChange={(e) => setLevel(e.target.value)}><option>初级</option><option>中级</option><option>高级</option></select></label>
                            <label className="field" style={{ gridColumn: '1 / -1' }}>目标岗位 JD（可选）<textarea value={jd} onChange={(e) => setJd(e.target.value)} rows={3} placeholder="粘贴岗位描述，让出题更有针对性（可选）" /></label>
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
                          <h3 style={{ marginTop: 18 }}>面试风格（本场）</h3>
                          <div className="choice">
                            {STYLES.map((s) => (
                              <button key={s.id} aria-pressed={style === s.id} onClick={() => setStyleAndSave(s.id)}>{s.name}<small>{s.desc}</small></button>
                            ))}
                          </div>
                          <label className="row" style={{ marginTop: 18, fontSize: 12 }}>
                            <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudioDefault(e.target.checked)} />保留本场录音，方便回听
                          </label>
                          <div className="actions"><button className="primary" onClick={() => (!resumeId ? setPage('resume') : bootstrap.mutate())} disabled={bootstrap.isPending}>{!resumeId ? '去导入简历 →' : bootstrap.isPending ? '生成面试计划…' : '查看面试流程 →'}</button></div>
                        </>
                      ) : (
                        <>
                          <h3>这些方向，值得一起深入。 <span className="tag blue">可多选</span></h3>
                          <div className="topic-grid">
                            {dirs.map((d) => {
                              const on = selectedDirs.includes(d.id);
                              return (
                                <div className={`topic${on ? ' on' : ''}`} key={d.id} role="button" tabIndex={0} aria-pressed={on} onClick={() => setSelectedDirs((s) => (on ? s.filter((x) => x !== d.id) : [...s, d.id]))} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedDirs((s) => (on ? s.filter((x) => x !== d.id) : [...s, d.id])); } }}>
                                  <span className="topic-body"><b>{d.name}</b>{d.reason ? <span className="topic-chips">{d.reason.split(/[/、,，]+/).filter((t) => t.trim()).map((t) => <i key={t}>{t.trim()}</i>)}</span> : null}</span>
                                </div>
                              );
                            })}
                            {customDirs.map((c) => {
                              const on = selectedDirs.includes(c.id);
                              return (
                                <div className={`topic${on ? ' on' : ''}`} key={c.id} role="button" tabIndex={0} aria-pressed={on} onClick={() => setSelectedDirs((s) => (on ? s.filter((x) => x !== c.id) : [...s, c.id]))} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedDirs((s) => (on ? s.filter((x) => x !== c.id) : [...s, c.id])); } }}>
                                  <button type="button" className="dir-remove" aria-label="删除该方向" onClick={(e) => { e.stopPropagation(); removeCustomDir(c.id); }}>×</button>
                                  <span className="custom-dir-body"><b>{c.name}</b><small>自定义方向</small></span>
                                </div>
                              );
                            })}
                            {addingDir ? (
                              <div className="topic add-dir-card">
                                <input autoFocus value={dirDraft} onChange={(e) => setDirDraft(e.target.value)} onBlur={() => addCustomDir()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomDir(); } if (e.key === 'Escape') { setAddingDir(false); setDirDraft(''); } }} placeholder="输入方向名称，回车确认" />
                              </div>
                            ) : (
                              <button type="button" className="topic add-dir" onClick={() => setAddingDir(true)} aria-label="新增方向">＋ 新增方向</button>
                            )}
                          </div>
                          <div className="row" style={{ marginTop: 10 }}><small>已选 {selectedDirs.length} 个方向 · 点击卡片可多选</small></div>
                          {outlinePhases && outlinePhases.length > 0 && (
                            <div className="flow" style={{ marginTop: 22 }}>
                              {outlinePhases.map((p) => (
                                <div className="flow-node" key={p.phase}>
                                  <span className="step-number">{p.phase === 'intro' ? '1' : p.phase === 'tech' ? '2' : p.phase === 'biz' ? '3' : '4'}</span>
                                  <b>{phaseLabel[p.phase] ?? p.phase}</b>
                                  <p>{p.minutes} 分钟 · {p.questionCount} 题</p>
                                </div>
                              ))}
                            </div>
                          )}
                          {outlineQuestions && outlineQuestions.length > 0 && (
                            <details style={{ marginTop: 14 }}>
                              <summary>题目预览（{outlineQuestions.length} 道）</summary>
                              <div style={{ marginTop: 8 }}>
                                {outlineQuestions.map((q, i) => (
                                  <div className="list-row" key={i} style={{ padding: '10px 0' }}>
                                    <div className="row" style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
                                      <span className="step-number">{i + 1}</span>
                                      <div style={{ minWidth: 0, flex: 1 }}>
                                        <b style={{ display: 'block', lineHeight: 1.6 }}>{q.mainQuestion}</b>
                                        <div className="row" style={{ marginTop: 5, gap: 6 }}>
                                          {q.difficulty && <span className="tag">{({ begin: '基础', mid: '进阶', deep: '深挖' } as Record<string, string>)[q.difficulty] ?? q.difficulty}</span>}
                                          {q.topic && <span className="tag">主题：{q.topic}</span>}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                          <div className="actions">
                            {topics.length === 0 ? (
                              <button className="primary" onClick={() => generatePlan.mutate()} disabled={generatePlan.isPending}>{generatePlan.isPending ? '生成面试流程…' : dirs.length === 0 ? '继续生成考察方向 →' : '按所选生成面试流程 →'}</button>
                            ) : (
                              <button className="primary" onClick={() => startInterview.mutate()} disabled={startInterview.isPending || beginTurn.isPending}>{startInterview.isPending || beginTurn.isPending ? '准备题目…' : '开始面试 →'}</button>
                            )}
                          </div>
                        </>
                      )}
                      {(bootstrap.isPending || generatePlan.isPending || planProgress.length > 0) && (
                        <section className="stream-panel" aria-live="polite" style={{ marginTop: 18 }}>
                          <div className="row between">
                            <div><b>计划生成实时进度</b><small> 岗位、方向与大纲的模型原始输出及校验状态</small></div>
                            <span className={`tag ${bootstrap.isPending || generatePlan.isPending ? 'blue' : 'green'}`}>{bootstrap.isPending || generatePlan.isPending ? '处理中' : '已结束'}</span>
                          </div>
                          <div className="stream-log">
                            {planProgress.map((event, index) => (
                              <div className={`stream-event ${event.phase}`} key={`${event.task}-${event.phase}-${index}`}>
                                <span>{({ P02: 'P02 岗位', P03: 'P03 方向', P04: 'P04 大纲' } as Record<string, string>)[event.task]} · {({ requesting: '请求', validating: '校验', retrying: '重试', complete: '完成', delta: '模型' } as Record<string, string>)[event.phase]}</span>
                                <pre>{event.message}</pre>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}
                    </section>
                  </div>
                </div>
              )}

              {active === 'room' && !turn && pendingAdjust === undefined && (
                <section className="card">
                  <div className="eyebrow">03 / 选择进行中的面试</div>
                  <h2>继续面试练习</h2>
                  <p className="subtitle">为保证题目、大纲、回答与评价属于同一场练习，请先选择一条已保存的进行中记录。</p>
                  {histQuery.isLoading ? <p className="muted">正在读取进行中的面试…</p> : history.filter((item) => item.status === 'active').length ? (
                    history.filter((item) => item.status === 'active').map((item) => (
                      <div className="list-row" key={item.id}>
                        <div><b>{item.targetRole} · {item.level === 'mid' ? '中级' : item.level === 'junior' ? '初级' : '高级'}</b><p>{item.kind === 'coach' ? '陪练' : '模拟'} · {item.currentPhase ? `${phaseLabel[item.currentPhase]}进行中` : '等待开始'} · {new Date(item.updatedAt).toLocaleString()}</p></div>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="primary" onClick={() => resumeInterview.mutate(item.id)} disabled={resumeInterview.isPending}>{resumeInterview.isPending ? '继续中…' : '继续这场'}</button>
                          <button className="danger ghost" onClick={() => askConfirm({ danger: true, title: '删除练习', message: `删除这场进行中的练习（${item.targetRole} · ${item.kind === 'coach' ? '陪练' : '模拟'}）？删除后不可恢复。`, confirmText: '删除', cancelText: '保留' }, () => deleteInterview.mutate(item.id))} disabled={deleteInterview.isPending}>删除</button>
                        </div>
                      </div>
                    ))
                  ) : <div className="empty"><div className="empty-icon">◎</div>暂无进行中的面试。请先在“准备面试”完成大纲并开始，或从工作台继续一场已保存记录。</div>}
                  <div className="actions"><button className="ghost" onClick={() => setPage('prepare')}>去准备面试 →</button></div>
                </section>
              )}

              {active === 'room' && (turn || pendingAdjust !== undefined) && (
                <div className="room">
                  <details className="mobile-flow">
                    <summary>本场流程 · 计时</summary>
                    <div style={{ padding: '8px 2px' }}>
                      {stages.map((name, i) => {
                        const idx = PHASES.indexOf(phase);
                        const ph = PHASES[i];
                        const state = phase && i < idx ? 'done' : phase && i === idx ? 'active' : '';
                        const done = phaseProgress[ph] ?? 0;
                        const planned = outlinePhases?.find((p) => p.phase === ph)?.questionCount;
                        return (
                          <div className={`stage ${state}`} key={name}><span className="step-number">{i < (phase ? idx : -1) ? '✓' : `${i + 1}`}</span><div><b>{name}</b><small>{state === 'done' ? '已完成' : state === 'active' ? '进行中' : '待开始'}{planned ? ` · 已答 ${done}/${planned} 题` : done ? ` · 已答 ${done} 题` : ''}</small></div></div>
                        );
                      })}
                      <div className="room-meta">{duration} 分钟 · {level} · {STYLES.find((s) => s.id === style)?.name}
                        {(() => {
                          const budget = parseInt(duration, 10);
                          const elapsed = startedAt ? Math.max(0, Math.floor((clock - new Date(startedAt).getTime()) / 60000)) : 0;
                          const overdue = startedAt && elapsed >= budget;
                          return (<span>{overdue ? ` ｜ 已超时（已进行 ${elapsed} 分钟，可收尾）` : startedAt ? ` ｜ 已进行 ${elapsed} / ${budget} 分钟` : ''}</span>);
                        })()}
                        <br />{topics.join(' / ')}</div>
                    </div>
                  </details>
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
                    {pendingAdjust !== undefined && (
                      <div className="notice" style={{ marginTop: 10 }}>
                        <b>自我介绍后的大纲调整建议</b>
                        <p style={{ marginTop: 8, marginBottom: 4 }}>{pendingAdjust.length ? pendingAdjust.map((c) => `· ${c.type === 'add' ? '新增' : c.type === 'remove' ? '移除' : '修改'}：${c.after}`).join('\n') : '暂无调整建议。'}</p>
                        {(pendingFollowups?.length ?? 0) > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <small style={{ color: 'var(--blue)', fontWeight: 600 }}>依据自我介绍的延伸追问（进入对应环节时下发）：</small>
                            <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 12, lineHeight: 1.7, color: '#5a6a85' }}>
                              {pendingFollowups!.map((f, i) => (
                                <li key={i}>〔{phaseLabel[f.phase] ?? f.phase}〕{f.question}{f.reason ? `（${f.reason}）` : ''}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="row" style={{ marginTop: 8 }}>
                          <button style={{ padding: '4px 10px', fontSize: 12 }} onClick={applyAdjustAndAdvance}>确认应用</button>
                          <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={skipAdjustAndAdvance}>跳过</button>
                        </div>
                      </div>
                    )}
                    <div className="room-meta">{duration} 分钟 · {level} · {STYLES.find((s) => s.id === style)?.name}
                      {(() => {
                        const budget = parseInt(duration, 10);
                        const elapsed = startedAt ? Math.max(0, Math.floor((clock - new Date(startedAt).getTime()) / 60000)) : 0;
                        const overdue = startedAt && elapsed >= budget;
                        return (<span>{overdue ? ` ｜ 已超时（已进行 ${elapsed} 分钟，可收尾）` : startedAt ? ` ｜ 已进行 ${elapsed} / ${budget} 分钟` : ''}</span>);
                      })()}
                      <br />{topics.join(' / ')}</div>
                  </aside>
                  <section className="card">
                    <div className="row between"><span className="tag blue">主问题</span><div className="row" style={{ gap: 6 }}><small>语音问答 · 可输入文本作答</small><button className="ghost" style={{ padding: '3px 9px', fontSize: 12 }} onClick={() => { setRecording(false); stopRecording(); setTurn(undefined); setPage('home'); }}>退出练习</button></div></div>
                    <div className="interviewer">
                      <span className="interviewer-avatar"><BrandMark /></span>
                      <div className="interviewer-meta"><b>面试官</b><small>沿着你的回答继续深入</small></div>
                    </div>
                    <h2 className="question">{turn?.question ?? '点击开始，面试官将提出第一题。'}</h2>
                    {turn?.answered ? null : (
                      <div className="row" style={{ marginTop: 6, gap: 6 }}>
                        {turn?.topic && <span className="tag">主题：{turn.topic}</span>}
                        {turn?.difficulty && <span className="tag">{({ begin: '基础', mid: '进阶', deep: '深挖' } as Record<string, string>)[turn.difficulty] ?? turn.difficulty}</span>}
                        {turn?.targetAspect && <span className="tag">侧重：{turn.targetAspect}</span>}
                      </div>
                    )}
                    <div className="question-context">先完整表达你的思路，再提交获得反馈。</div>
                    {pendingAdjust !== undefined && (
                      <div className="notice mobile-only" style={{ marginTop: 12 }}>
                        <b>自我介绍后的大纲调整建议</b>
                        <p style={{ marginTop: 8, marginBottom: 4 }}>{pendingAdjust.length ? pendingAdjust.map((c) => `· ${c.type === 'add' ? '新增' : c.type === 'remove' ? '移除' : '修改'}：${c.after}`).join('\n') : '暂无调整建议。'}</p>
                        {(pendingFollowups?.length ?? 0) > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <small style={{ color: 'var(--blue)', fontWeight: 600 }}>依据自我介绍的延伸追问（进入对应环节时下发）：</small>
                            <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 12, lineHeight: 1.7, color: '#5a6a85' }}>
                              {pendingFollowups!.map((f, i) => (
                                <li key={i}>〔{phaseLabel[f.phase] ?? f.phase}〕{f.question}{f.reason ? `（${f.reason}）` : ''}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="row" style={{ marginTop: 8 }}>
                          <button style={{ padding: '4px 10px', fontSize: 12 }} onClick={applyAdjustAndAdvance}>确认应用</button>
                          <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={skipAdjustAndAdvance}>跳过</button>
                        </div>
                      </div>
                    )}
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
                      {(submitAnswer.isPending || answerProgress.length > 0) && (
                        <section className="stream-panel answer" aria-live="polite">
                          <div className="row between">
                            <div><b>回答评价实时进度</b><small> 转写、评价与追问决策的模型原始输出及校验状态</small></div>
                            <span className={`tag ${submitAnswer.isPending ? 'blue' : 'green'}`}>{submitAnswer.isPending ? '处理中' : '已结束'}</span>
                          </div>
                          <div className="stream-log">
                            {answerProgress.map((event, index) => (
                              <div className={`stream-event ${event.phase}`} key={`${event.task}-${event.phase}-${index}`}>
                                <span>{({ ASR: '转写', P07: 'P07 评价', P08: 'P08 追问' } as Record<string, string>)[event.task]} · {({ requesting: '请求', validating: '校验', retrying: '重试', complete: '完成', delta: '模型' } as Record<string, string>)[event.phase]}</span>
                                <pre>{event.message}</pre>
                              </div>
                            ))}
                          </div>
                        </section>
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
                          {(() => { const p = plannedOf(phase); const d = phaseProgress[phase] ?? 0; return p && d >= p ? <div className="notice" style={{ marginBottom: 10, background: '#edf8f3', color: 'var(--green)' }}>本环节计划题数已完成（{d}/{p}），可进入下一环节，或继续加练。</div> : null; })()}
                          {mode === 'coach' && !scoreHistory.some((s) => s.stage === 'after_hint') && (
                            <button className="ghost" onClick={() => { setRevising(true); setDraft(''); setRecording(false); stopRecording(); reanswerStartRef.current = Date.now(); setTurn({ ...turn!, answered: undefined }); }}>重新回答</button>
                          )}
                          {mode === 'coach' && turn.answered?.followup.length ? (
                            <button onClick={() => askFollowUp.mutate()} disabled={askFollowUp.isPending || followUpCount >= 3}>{followUpCount >= 3 ? '追问已满（3/3）' : followUpCount > 0 ? `再追问（${followUpCount}/3）` : '追问 →'}</button>
                          ) : null}
                          {phase !== 'intro' && (
                            <button onClick={() => beginTurn.mutate()} disabled={beginTurn.isPending}>同环节再问一题</button>
                          )}
                          {/* 收尾入口二选一：未到最后一题时给「下一环节 / 提前完成」，到最后一题才升级为高亮「完成面试，查看报告」。 */}
                          {!isLastQuestion && (
                            phase === 'hr'
                              ? <button onClick={goFinish} disabled={finish.isPending}>完成面试</button>
                              : <button onClick={advance}>下一环节 →</button>
                          )}
                          {isLastQuestion && (
                            <button className="primary" onClick={goFinish} disabled={finish.isPending} style={startedAt && Math.floor((clock - new Date(startedAt).getTime()) / 60000) >= parseInt(duration, 10) ? { background: '#b34545', borderColor: '#b34545' } : undefined}>{finish.isPending ? '生成报告…' : '完成面试，查看报告 →'}</button>
                          )}
                        </div>
                      )}
                    </div>
                  </section>
                  <aside className="card feedback">
                    {!turn?.answered ? (
                      <div className="empty">
                        <div className="empty-icon">◌</div>
                        <b style={{ fontSize: 15 }}>答题后查看本轮反馈</b>
                        <p className="muted" style={{ margin: '6px 0 2px' }}>这里会展示 AI 对本轮回答的评分、逐维度表现与优化建议。</p>
                        <div className="feedback-preview"><span className="tag">综合评分</span><span className="tag">逐维表现</span><span className="tag">优化建议</span></div>
                      </div>
                    ) : (
                      <>
                        <div className="row between"><h3>本轮反馈</h3><div className="row" style={{ gap: 6 }}><span className="tag ai">AI 生成</span><span className="tag blue">{mode === 'mock' ? '模拟' : '陪练'}</span></div></div>
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
                            {turn.answered.transcript && <p className="quote" style={{ marginTop: 8 }}>作答转写：「{turn.answered.transcript}」</p>}
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
                        <div className="row"><span className="tag">{role}</span><span className="tag">{level}</span><span className="tag blue">复盘报告</span><span className="tag ai">AI 生成</span>{report.keepAudio && <span className="tag green">录音已保留 · 可回听</span>}</div>
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
                  {report.highlight && (
                    <section className="card section-title">
                      <div className="row between"><h2>本场最佳 & 最需改进</h2><span className="tag amber">报告高亮</span></div>
                      <div className="highlight-grid">
                        <div className="highlight-item">
                          <span className="tag green">最佳作答</span>
                          {report.highlight.best.q && <b style={{ marginTop: 8 }}>{report.highlight.best.q}</b>}
                          <p className="muted" style={{ marginBottom: 0 }}>{report.highlight.best.why}</p>
                        </div>
                        <div className="highlight-item">
                          <span className="tag amber">最需改进</span>
                          {report.highlight.improve.q && <b style={{ marginTop: 8 }}>{report.highlight.improve.q}</b>}
                          <p className="muted" style={{ marginBottom: 0 }}>{report.highlight.improve.why}</p>
                        </div>
                      </div>
                    </section>
                  )}
                  <section className="card section-title"><div className="row between"><h2>下一个题，专注这 {report.actions.length} 件事</h2><span className="tag blue">行动清单</span></div>
                    <div className="action-grid">
                      {report.actions.map((a, i) => <div className="list-row" key={i}><div className="row"><span className="step-number">0{i + 1}</span><div><b>{a}</b></div></div></div>)}
                    </div>
                  </section>

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
                  <div className="actions"><button onClick={() => { setReport(undefined); setReview([]); setTrend(undefined); }}>全部历史报告</button><button onClick={exportReport}>导出报告 ⤓</button><button className="primary" onClick={() => { setPage('home'); setInterviewId(undefined); setPhase('intro'); setTurn(undefined);
      setPhaseProgress({});
      setPendingAdjust(undefined); setPendingFollowups(undefined); setReport(undefined);
      setTrend(undefined); setReview([]); setCoaching(undefined); setTopics([]); setCustomDirs([]); setOutlinePhases(undefined);
      setOutlineQuestions(undefined); setSelectedDirs([]); setDirs([]); setAdjustNote(undefined); setStartedAt(undefined); }}>再来一次 →</button></div>
                </>
              )}

              {active === 'report' && !report && (
                <section className="card">
                  <div className="eyebrow">04 / 已完成记录</div>
                  <div className="row between"><h2>历史复盘报告</h2><span className="tag ai">AI 生成</span></div>
                  <p className="subtitle">选择一场已完成的面试，查看其八维表现、逐题回答与行动建议。</p>
                  {histQuery.isLoading ? <p className="muted">正在读取历史报告…</p> : history.filter((item) => item.status === 'finished' && item.report).length ? (
                    history.filter((item) => item.status === 'finished' && item.report).map((item) => (
                      <div className="list-row" key={item.id}>
                        <div><b>{item.targetRole} · {item.level === 'mid' ? '中级' : item.level === 'junior' ? '初级' : '高级'}</b><p>{item.kind === 'coach' ? '陪练' : '模拟'} · {item.report?.overview.avgScore} 分 · 完成 {item.report?.overview.completedAnswers} 题 · {new Date(item.updatedAt).toLocaleString()}</p></div>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="primary" onClick={() => openHistory.mutate(item.id)} disabled={openHistory.isPending}>{openHistory.isPending ? '打开中…' : '查看报告'}</button>
                          <button className="danger ghost" onClick={() => askConfirm({ danger: true, title: '删除复盘报告', message: `删除这份复盘报告（${item.targetRole} · ${item.kind === 'coach' ? '陪练' : '模拟'}）？删除后不可恢复。`, confirmText: '删除', cancelText: '保留' }, () => deleteInterview.mutate(item.id))} disabled={deleteInterview.isPending}>删除</button>
                        </div>
                      </div>
                    ))
                  ) : <div className="empty"><div className="empty-icon">◎</div>还没有已完成的面试报告。完成一场练习后，整场八维报告会保存在这里。</div>}
                </section>
              )}

              {active === 'admin' && (
                <div className="grid2">
                  <section className="card">
                    <div className="row between"><h2>任务模板</h2><span className="tag blue">P01—P10</span></div>
                    {tplQuery.isLoading ? <p className="muted">加载中…</p> : (tplQuery.data?.items ?? []).map((t) => (
                      <div className="list-row" key={t.id}>
                        <div><b>{t.taskCode} · {t.name}</b><p>{t.description}</p>{t.variables?.length ? <p className="muted" style={{ marginTop: 6 }}>上下文变量：{t.variables.map((v) => <span className="tag" key={v} style={{ marginRight: 4 }}>{v}</span>)}</p> : null}</div>
                        <div className="row">
                          <button className={selId === t.id ? 'primary' : ''} onClick={() => setSelId(t.id)}>编辑</button>
                          <button className="danger ghost" onClick={() => askConfirm({ danger: true, title: '删除模板', message: `删除模板 ${t.taskCode} 及其全部版本？已开始面试的回落到默认提示词。`, confirmText: '删除', cancelText: '取消' }, () => deleteTemplate.mutate(t.id))} disabled={deleteTemplate.isPending}>删除</button>
                        </div>
                      </div>
                    ))}
                  </section>
                  <section className="card">
                    <h2>模板草稿{(() => { const t = (tplQuery.data?.items ?? []).find((x) => x.id === selId); return t ? ` · ${t.taskCode} ${t.name}` : ''; })()}</h2>
                    {!selId ? (
                      <div className="empty">选择一个任务模板开始编辑。<br />MVP 中模板为管理数据，尚不影响 Mock 生成。</div>
                    ) : (
                      <>
                        {(() => { const t = (tplQuery.data?.items ?? []).find((x) => x.id === selId); return t?.variables?.length ? <p className="muted" style={{ marginBottom: 10 }}>可用上下文变量：{t.variables.map((v) => <span className="tag" key={v} style={{ marginRight: 4 }}>{v}</span>)}</p> : null; })()}
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
                            <div>
                              <div className="row">{`v${v.versionNo}`}
                                <span className="tag">{v.status}</span>
                                {v.basedOnId && <small>回滚自 {v.id.slice(0, 8)}</small>}
                              </div>
                              {v.testResult?.note && <small className="muted" style={{ display: 'block', marginTop: 6 }}>{v.testResult.note}</small>}
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
                <>
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
                    <div className="field-group">
                      <label className="field" style={{ marginTop: 12 }}>Base URL<input type="text" value={cfgMode.baseUrl} disabled={cfgMode.mode === 'platform'} onChange={(e) => setCfgMode((c) => ({ ...c, baseUrl: e.target.value }))} placeholder="https://open.bigmodel.cn/api/paas/v4" /></label>
                      <label className="field">模型名<input type="text" value={cfgMode.model} disabled={cfgMode.mode === 'platform'} onChange={(e) => setCfgMode((c) => ({ ...c, model: e.target.value }))} placeholder="glm-4-flash" /></label>
                      <label className="field">API Key<input type="password" value={cfgMode.apiKey} disabled={cfgMode.mode === 'platform'} onChange={(e) => setCfgMode((c) => ({ ...c, apiKey: e.target.value }))} placeholder="sk-…（可选，保存在服务端内存）" /></label>
                    </div>
                    <div className="actions">
                      <button className="primary" onClick={() => saveModel.mutate()} disabled={saveModel.isPending}>{saveModel.isPending ? '保存中…' : '保存并生效'}</button>
                      <button onClick={() => testModel.mutate()} disabled={testModel.isPending}>{testModel.isPending ? '测试中…' : '测试连接'}</button>
                      <span className="tag">{modelQuery.data ? { mock: '默认样本（无需密钥）', platform: '平台默认', custom: '自定义 API' }[modelQuery.data.status.mode] : '加载中…'}</span>
                    </div>
                    {saveOk && (
                      <div className="notice" style={{ marginTop: 12, background: '#edf8f3', color: 'var(--green)' }}>已保存并生效。</div>
                    )}
                    {testResult && (
                      <div className="notice" style={{ marginTop: 12, ...(testResult.ok ? { background: '#edf8f3', color: 'var(--green)' } : { background: '#fff1f0', color: '#b34545' }) }}>
                        {testResult.ok ? `连接成功 · 延迟 ${testResult.latencyMs} ms` : `连接失败：${testResult.error ?? '未知错误'}`}
                      </div>
                    )}
                  </section>
                  <section className="card"><h2>账号与数据</h2>
                    <div className="setting-row"><div><b>求职者</b><p>Web 与小程序使用同一份练习记录</p></div><span className="tag">示例</span></div>
                    <div className="setting-row"><div><b>回答录音</b><p>新场次的默认保留偏好，准备页也可按本场调整</p></div><button onClick={() => setKeepAudioDefault(!keepAudio)} aria-pressed={keepAudio}>{keepAudio ? <span className="tag green">默认保留</span> : <span className="tag">默认仅转写</span>}</button></div>
                  </section>
                </div>
                <section className="card" style={{ marginTop: 20 }}>
                  <h2>面试风格（默认）</h2>
                  <p className="subtitle">作为新场次的默认风格，准备页可对单场调整；只影响反馈文案口径，不改变评分标准。</p>
                  <div className="choice" style={{ marginTop: 14 }}>
                    {STYLES.map((s) => (
                      <button key={s.id} aria-pressed={style === s.id} onClick={() => setStyleAndSave(s.id)}>{s.name}<small>{s.desc}</small></button>
                    ))}
                  </div>
                  <p className="muted" style={{ marginTop: 10 }}>当前默认：{STYLES.find((s) => s.id === style)?.name}</p>
                </section>
                </>
              )}
            </div>
          </div>
            <nav className="mobile-nav">
              {nav.map((n) => (
                <button key={n.k} className={active === n.k ? 'active' : ''} onClick={() => setPage(n.k)}>
                  <span><Icon name={n.icon} size={19} /></span>{n.label}
                </button>
              ))}
            </nav>
        </div>
      </div>

        {confirmState && (
          <ConfirmDialog
            opts={confirmState.opts}
            onConfirm={() => { const fn = confirmState.onConfirm; setConfirmState(undefined); fn(); }}
            onCancel={() => setConfirmState(undefined)}
          />
        )}
    </div>
  );
}
