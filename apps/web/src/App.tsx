import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { gradeOf } from '@ai-interviewer/contracts';
import { api } from './api';

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

interface RoomTurn {
  id: string;
  question: string;
  answered?: { transcript: string; score: number; grade: string; overall: string; dims: { dim: string; displayScore?: number }[]; strengths: string[]; weaknesses: string[]; suggestion: string; followup: string[] };
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
  const [interviewId, setInterviewId] = useState<string>();
  const [dirs, setDirs] = useState<{ id: string; name: string; weight: number; reason?: string }[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [turn, setTurn] = useState<RoomTurn>();
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [report, setReport] = useState<{ avgScore: number; grade: string; completed: number; coverage: string; dims: { dim: string; displayScore?: number }[]; actions: string[] }>();
  const [error, setError] = useState<string>();

  const run = <T,>(p: Promise<T>): Promise<T> => p.catch((e: unknown) => { setError(String((e as Error)?.message ?? e)); throw e; });

  const parseResume = useMutation({
    mutationFn: async () => {
      const r = await run(api.createResume(text));
      setResumeId(r.resume.id);
      setAnalysis(r.resume.analysis.summary);
      setPage('prepare');
    },
  });

  const bootstrap = useMutation({
    mutationFn: async () => {
      if (!resumeId) throw new Error('请先导入简历');
      const interview = await run(api.createInterview(resumeId));
      await run(api.analyze(interview.interview.id));
      const d = await run(api.directions(interview.interview.id));
      setDirs(d.recommendedDirections.recommendedDirections);
      const o = await run(api.outline(interview.interview.id));
      setTopics(o.outline.outline.map((q) => q.topic));
      await run(api.start(interview.interview.id));
      setInterviewId(interview.interview.id);
      setError(undefined);
    },
  });

  const beginTurn = useMutation({
    mutationFn: async () => {
      const res = await run(api.newTurn(interviewId!));
      setDraft('');
      setTurn({ id: res.turn.id, question: res.turn.question });
      setPage('room');
    },
  });

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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

  const submitAnswer = useMutation({
    mutationFn: async (payload: { transcript?: string; audioRef?: string }) => {
      setRecording(false);
      mediaRef.current = null;
      const transcript = payload.transcript ?? draft;
      const answered = await run(api.answer(interviewId!, turn!.id, payload.audioRef ? { audioRef: payload.audioRef } : { transcript }));
      setTurn({
        ...turn!,
        answered: {
          transcript: transcript || '(音频作答)',
          score: answered.evaluation.score,
          grade: answered.evaluation.grade,
          overall: answered.evaluation.overall,
          dims: answered.evaluation.dims,
          strengths: answered.evaluation.strengths ?? [],
          weaknesses: answered.evaluation.weaknesses ?? [],
          suggestion: answered.evaluation.suggestions?.[0]?.body ?? '',
          followup: answered.next.questions.map((q) => q.text),
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

  const finish = useMutation({
    mutationFn: async () => {
      const res = await run(api.finish(interviewId!));
      const evScore = (turn?.answered?.score ?? 0);
      setReport({
        avgScore: res.report.overview.avgScore,
        grade: gradeOf(evScore),
        completed: res.report.overview.completedAnswers,
        coverage: `${res.report.overview.directionCoverage.covered}/${res.report.overview.directionCoverage.planned}`,
        dims: turn?.answered?.dims ?? [],
        actions: res.report.actionPlan.map((a) => `${a.area}：${a.suggestion}`),
      });
      setPage('report');
    },
  });

  const active = page;
  const breadcrumb = `首页 / ${titles[active]}`;

  // ---- 工作台：历史报告 ----
  const histQuery = useQuery({ queryKey: ['interviews'], queryFn: api.listInterviews, enabled: page === 'home' });
  const history = histQuery.data?.items ?? [];
  const finCount = history.filter((h) => h.status === 'finished').length;
  const avgFinished = (() => {
    const scores = history.filter((h) => h.status === 'finished' && h.report).map((h) => h.report!.overview.avgScore);
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  })();
  const openHistory = useMutation({
    mutationFn: async (id: string) => {
      const detail = await run(api.getInterview(id));
      const r = detail.interview.report;
      if (!r) throw new Error('该场尚无报告');
      setReport({
        avgScore: r.overview.avgScore,
        grade: gradeOf(r.overview.avgScore),
        completed: r.overview.completedAnswers,
        coverage: `${r.overview.directionCoverage.covered}/${r.overview.directionCoverage.planned}`,
        dims: (r.dimensionReport ?? []).map((d) => ({ dim: d.dim, displayScore: Math.round(d.overallScore * 20) })),
        actions: (r.actionPlan ?? []).map((a) => `${a.area}：${a.suggestion}`),
      });
      setPage('report');
    },
    onSuccess: () => histQuery.refetch(),
  });

  // ---- 管理员提示词管理 ----
  const [selId, setSelId] = useState<string>();
  const [draftText, setDraftText] = useState('');
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
                {active === 'report' && <span className="tag amber">示例报告</span>}
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

                  {history.length > 0 && (
                    <section className="card section-title">
                      <h2>历史场次</h2>
                      {history.map((h) => (
                        <div className="list-row" key={h.id}>
                          <div>
                            <b>{h.targetRole} · {h.level === 'mid' ? '中级' : h.level === 'junior' ? '初级' : '高级'}</b>
                            <p>{h.kind === 'coach' ? '陪练' : '模拟'} · {h.status === 'finished' ? `报告 ${h.report?.overview.avgScore} 分 · 完成 ${h.report?.overview.completedAnswers} 题` : h.status === 'active' ? '进行中' : '草稿'} · {new Date(h.updatedAt).toLocaleString()}</p>
                          </div>
                          {h.status === 'finished' ? (
                            <button onClick={() => openHistory.mutate(h.id)} disabled={openHistory.isPending}>查看报告</button>
                          ) : (
                            <span className="tag">{h.status}</span>
                          )}
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
                      <h3>粘贴简历内容</h3>
                      <p>PDF、DOCX、Markdown、TXT</p>
                      <textarea data-field="resumeText" value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="粘贴你的项目经历、技术栈与工作经历…" />
                    </div>
                    <div className="actions">
                      <button className="primary" onClick={() => parseResume.mutate()} disabled={parseResume.isPending}>
                        {parseResume.isPending ? '解析中…' : '载入示例分析 →'}
                      </button>
                    </div>
                  </section>
                  <section className="card">
                    <div className="row between"><h2>确认分析结果</h2><span className="tag blue">{analysis ? '待你确认' : '示例'}</span></div>
                    <label className="field">候选人概况<input value={analysis ?? '林同学 · Java 后端 · 3 年'} readOnly /></label>
                    {['Java', 'Spring Boot', 'MySQL', 'Redis', 'MQ'].map((x) => <span className="tag" key={x} style={{ marginRight: 6 }}>{x}</span>)}
                    <div className="resume-block"><h3>电商订单与库存服务</h3><p>负责订单接口与促销库存扣减改造，参与压测及重复下单处理方案讨论。</p></div>
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
                            {dirs.map((d) => <div className="topic" key={d.id}><span className="step-number">{Math.round(d.weight * 10)}</span><span><b>{d.name}</b><small>{d.reason}</small></span></div>)}
                          </div>
                          <h3 style={{ marginTop: 18 }}>目标岗位：{role} · {level}</h3>
                          <div className="row">{topics.map((t) => <span className="summary-chip" key={t}>{t}</span>)}</div>
                          <div className="actions">
                            <button className="primary" onClick={() => beginTurn.mutate()} disabled={beginTurn.isPending}>{beginTurn.isPending ? '准备题目…' : '开始自我介绍 →'}</button>
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
                    {stages.map((name, i) => <div className="stage" key={name}><span className="step-number">0{i + 1}</span><div><b>{name}</b><small>待开始</small></div></div>)}
                    <div className="room-meta">{duration} 分钟 · {level}<br />{topics.join(' / ')}</div>
                  </aside>
                  <section className="card">
                    <div className="row between"><span className="tag blue">主问题</span><small>语音问答 · 可输入文本作答</small></div>
                    <div className="row" style={{ marginTop: 22 }}><span className="bot">面试官</span><div><b>面试官</b><br /><small>沿着你的回答继续深入</small></div></div>
                    <h2 className="question">{turn?.question ?? '点击开始，面试官将提出第一题。'}</h2>
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
                          <button onClick={() => beginTurn.mutate()}>下一题</button>
                          <button className="primary" onClick={() => finish.mutate()} disabled={finish.isPending}>{finish.isPending ? '生成报告…' : '完成面试，查看报告 →'}</button>
                        </div>
                      )}
                    </div>
                  </section>
                  <aside className="card feedback">
                    {!turn?.answered ? (
                      <div className="empty"><div className="empty-icon">◌</div>回答结束后，<br />在这里查看评分与优化建议。</div>
                    ) : (
                      <>
                        <div className="row between"><h3>本轮反馈</h3><span className="tag blue">陪练</span></div>
                        <div className="score">{turn.answered.score}<small> / 100 · {turn.answered.grade}</small></div>
                        <p className="subtitle">{turn.answered.overall}</p>
                        {turn.answered.dims.map((d) => (
                          <div className="score-row" key={d.dim}><span>{d.dim}</span><span className="bar"><i style={{ width: `${d.displayScore ?? 0}%` }} /></span><span>{d.displayScore ?? '—'}</span></div>
                        ))}
                        <div className="feedback-block"><h3>做得好的地方</h3><p>{turn.answered.strengths.join('；') || '—'}</p></div>
                        <div className="feedback-block"><h3>还缺少什么</h3><p>{turn.answered.weaknesses.join('；') || turn.answered.suggestion}</p></div>
                        {turn.answered.followup.length > 0 && <div className="feedback-block"><h3>挑香追问</h3><p>{turn.answered.followup.join('；')}</p></div>}
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
                        <h2>基础表达清楚，方案取舍需要更深入。</h2>
                        <p className="muted">当场回答了 {report.completed} 题，方向覆盖 {report.coverage}。整体可以进一步补充适用前提、失败处理和验证结果。</p>
                        <div className="row"><span className="tag">{role}</span><span className="tag">{level}</span><span className="tag blue">复盘报告</span></div>
                      </div>
                    </div>
                    <div className="dimension-grid" style={{ marginTop: 25 }}>
                      {report.dims.map((d) => (
                        <div className="score-row" key={d.dim}><span style={{ minWidth: 100 }}>{d.dim}</span><span className="bar"><i style={{ width: `${d.displayScore ?? 0}%` }} /></span><b>{d.displayScore ?? '—'}</b></div>
                      ))}
                    </div>
                  </section>
                  <div className="grid2 section-title">
                    <section className="card"><h2>下一个题，专注这三件事</h2>
                      {report.actions.map((a, i) => <div className="list-row" key={i}><div className="row"><span className="step-number">0{i + 1}</span><div><b>{a}</b></div></div></div>)}
                    </section>
                  </div>
                  <div className="actions"><button className="primary" onClick={() => { setPage('home'); setInterviewId(undefined); setResumeId(undefined); }}>再来一次 →</button></div>
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
                    <div className="choice"><button aria-pressed>平台默认<small>无需填写密钥</small></button><button>自定义 API<small>使用自己的服务配置</small></button></div>
                    <div className="notice" style={{ marginTop: 20 }}>GLM、DeepSeek、Qwen 的具体模型与语音能力将在真实厂商接入阶段配置。</div>
                  </section>
                  <section className="card"><h2>账号与数据</h2>
                    <div className="setting-row"><div><b>林同学 · 演示账号</b><p>Web 与小程序使用同一份练习记录</p></div><span className="tag">示例</span></div>
                    <div className="setting-row"><div><b>回答录音</b><p>每场开始前，由你选择是否保留</p></div>{keepAudio ? <span className="tag green">本场保留</span> : <span className="tag">仅转写</span>}</div>
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}