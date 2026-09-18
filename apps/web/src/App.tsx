import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from './api';

type NavKey = 'home' | 'resume' | 'prepare' | 'room' | 'report' | 'settings';
const titles: Record<NavKey, string> = { home: '工作台', resume: '我的简历', prepare: '准备面试', room: '面试练习室', report: '复盘报告', settings: '设置' };
const nav: { k: NavKey; icon: string; label: string }[] = [
  { k: 'home', icon: '⌂', label: '工作台' },
  { k: 'resume', icon: '▤', label: '我的简历' },
  { k: 'prepare', icon: '＋', label: '准备面试' },
  { k: 'room', icon: '▥', label: '面试练习室' },
  { k: 'report', icon: '≡', label: '复盘报告' },
  { k: 'settings', icon: '⚙', label: '设置' },
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

  const submitAnswer = useMutation({
    mutationFn: async () => {
      const res = await run(api.answer(interviewId!, turn!.id, draft));
      setTurn({
        ...turn!,
        answered: {
          transcript: draft,
          score: res.evaluation.score,
          grade: res.evaluation.grade,
          overall: res.evaluation.overall,
          dims: res.evaluation.dims,
          strengths: res.evaluation.strengths ?? [],
          weaknesses: res.evaluation.weaknesses ?? [],
          suggestion: res.evaluation.suggestions?.[0]?.body ?? '',
          followup: res.next.questions.map((q) => q.text),
        },
      });
    },
  });

  const finish = useMutation({
    mutationFn: async () => {
      const res = await run(api.finish(interviewId!));
      const evScore = (turn?.answered?.score ?? 0);
      setReport({
        avgScore: res.report.overview.avgScore,
        grade: evScore >= 90 ? 'A+' : evScore >= 80 ? 'A' : evScore >= 70 ? 'B+' : evScore >= 60 ? 'B' : 'C',
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
                    <section className="card"><small>已练习场次</small><div className="metric">12<span>场</span></div></section>
                    <section className="card"><small>平均表现</small><div className="metric">B+<span>评级</span></div></section>
                    <section className="card"><small>连续训练</small><div className="metric">5<span>天</span></div></section>
                  </div>
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
                      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="输出你的回答…" disabled={!!turn?.answered} />
                      <div className="actions" style={{ marginTop: 10 }}>
                        {!turn?.answered ? (
                          <button className="primary" onClick={() => submitAnswer.mutate()} disabled={submitAnswer.isPending || !turn}>
                            {submitAnswer.isPending ? '提交并评价…' : '回答完成，提交 →'}
                          </button>
                        ) : (
                          <>
                            <button onClick={() => beginTurn.mutate()}>下一题</button>
                            <button className="primary" onClick={() => finish.mutate()} disabled={finish.isPending}>{finish.isPending ? '生成报告…' : '完成面试，查看报告 →'}</button>
                          </>
                        )}
                      </div>
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