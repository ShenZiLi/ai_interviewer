import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from './api';

type Step = 'resume' | 'outline' | 'room' | 'done';

interface RoomTurn {
  id: string;
  question: string;
  answered: { transcript: string; score: number; grade: string; overall: string; dims: { dim: string; displayScore?: number }[]; followup: string[] };
}

export function App() {
  const [step, setStep] = useState<Step>('resume');
  const [text, setText] = useState('三年 Java 后端，负责订单与库存扣减改造，熟悉 Spring Boot、MySQL、Redis、消息队列。');
  const [interviewId, setInterviewId] = useState<string>();
  const [plan, setPlan] = useState<{ summary: string; questions: string[] }>();
  const [turn, setTurn] = useState<RoomTurn>();
  const [answerDraft, setAnswerDraft] = useState('');
  const [report, setReport] = useState<{ avgScore: number; completed: number; coverage: string; actions: string[] }>();

  const toInterview = useMutation({
    mutationFn: async () => {
      const resume = await api.createResume(text);
      const interview = await api.createInterview(resume.resume.id);
      const position = await api.analyze(interview.interview.id);
      await api.directions(interview.interview.id);
      const outline = await api.outline(interview.interview.id);
      await api.start(interview.interview.id);
      setInterviewId(interview.interview.id);
      setPlan({
        summary: `${position.position.role} · ${position.position.seniority}`,
        questions: outline.outline.outline.map((q) => q.topic),
      });
      setStep('outline');
    },
  });

  const beginTurn = useMutation({
    mutationFn: async () => {
      const res = await api.newTurn(interviewId!);
      setTurn({ id: res.turn.id, question: res.turn.question, answered: undefined as never });
      setStep('room');
    },
  });

  const submitAnswer = useMutation({
    mutationFn: async () => {
      const res = await api.answer(interviewId!, turn!.id, answerDraft);
      setTurn({
        ...turn!,
        answered: {
          transcript: answerDraft,
          score: res.evaluation.score,
          grade: res.evaluation.grade,
          overall: res.evaluation.overall,
          dims: res.evaluation.dims,
          followup: res.next.questions.map((q) => q.text),
        },
      });
    },
  });

  const finish = useMutation({
    mutationFn: async () => {
      const res = await api.finish(interviewId!);
      setReport({
        avgScore: res.report.overview.avgScore,
        completed: res.report.overview.completedAnswers,
        coverage: `${res.report.overview.directionCoverage.covered}/${res.report.overview.directionCoverage.planned}`,
        actions: res.report.actionPlan.map((a) => `${a.area}：${a.suggestion}`),
      });
      setStep('done');
    },
  });

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 720 }}>
      <h1>AI 面试教练 · MVP 闭环</h1>

      {step === 'resume' && (
        <section style={{ display: 'grid', gap: 12 }}>
          <label>
            粘贴简历内容
            <br />
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} style={{ width: '100%' }} />
          </label>
          <button onClick={() => toInterview.mutate()} disabled={toInterview.isPending}>
            {toInterview.isPending ? '解析简历并创建面试…' : '开始（创建简历 + 分析 + 大纲 + 开考）'}
          </button>
          {toInterview.isError && <p style={{ color: '#E8463A' }}>失败：{String(toInterview.error)}</p>}
        </section>
      )}

      {step === 'outline' && (
        <section style={{ display: 'grid', gap: 12 }}>
          <h2>面试计划</h2>
          <p>{plan?.summary}</p>
          <b>考察方向：{plan?.questions.join('、')}</b>
          <button onClick={() => beginTurn.mutate()} disabled={beginTurn.isPending}>
            {beginTurn.isPending ? '生成第一题…' : '进入面试室，开始第一题'}
          </button>
        </section>
      )}

      {step === 'room' && turn && (
        <section style={{ display: 'grid', gap: 12 }}>
          <h2>面试官提问</h2>
          <p style={{ fontSize: 18 }}>{turn.question}</p>
          {turn.answered ? (
            <div style={{ border: '1px solid #eee', padding: 12 }}>
              <p><b>我的回答：</b>{turn.answered.transcript}</p>
              <p style={{ color: '#4B3FE3' }}>
                评分 {turn.answered.score}（{turn.answered.grade}）— {turn.answered.overall}
              </p>
              <ul>
                {turn.answered.dims.map((d) => (
                  <li key={d.dim}>{d.dim}: {d.displayScore ?? '—'}</li>
                ))}
              </ul>
              {turn.answered.followup.length > 0 && <p><b>追问：</b>{turn.answered.followup.join('；')}</p>}
              <button onClick={() => setStep('outline')}>下一题</button>
              <button onClick={() => finish.mutate()} disabled={finish.isPending}>结束本场并出报告</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              <textarea value={answerDraft} onChange={(e) => setAnswerDraft(e.target.value)} rows={4} placeholder="输入你的回答…" />
              <button onClick={() => submitAnswer.mutate()} disabled={submitAnswer.isPending}>
                {submitAnswer.isPending ? '提交并评价…' : '提交回答（陪练：即时反馈）'}
              </button>
              {submitAnswer.isError && <p style={{ color: '#E8463A' }}>失败：{String(submitAnswer.error)}</p>}
            </div>
          )}
        </section>
      )}

      {step === 'done' && report && (
        <section style={{ display: 'grid', gap: 8 }}>
          <h2>复盘报告</h2>
          <p>平均分 {report.avgScore} ｜ 方向覆盖 {report.coverage} ｜ 完成 {report.completed} 题</p>
          <ul>
            {report.actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}