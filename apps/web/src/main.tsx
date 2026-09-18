import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
const API = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3000/api/v1';
async function api(path: string, init: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const r = await fetch(API + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
function Auth({ onLogin }: { onLogin: () => void }) {
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const d = await api(`/auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem('token', d.accessToken);
      onLogin();
    } catch (err) {
      setError(String(err));
    }
  }
  return (
    <main className="shell auth">
      <section className="card">
        <p className="eyebrow">AI INTERVIEWER</p>
        <h1>{register ? '创建账号' : '欢迎回来'}</h1>
        <p className="muted">真实 GLM 面试训练 · 数据持久化</p>
        <form onSubmit={submit}>
          <label>
            用户名
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button>{register ? '注册并开始' : '登录'}</button>
        </form>
        <button className="link" onClick={() => setRegister(!register)}>
          {register ? '已有账号，去登录' : '还没有账号，去注册'}
        </button>
      </section>
    </main>
  );
}
function App() {
  const [logged, setLogged] = useState(!!localStorage.getItem('token'));
  const [tab, setTab] = useState<'home' | 'resume' | 'interview'>('home');
  const [resumes, setResumes] = useState<any[]>([]);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [position, setPosition] = useState('Java 后端工程师');
  const [selected, setSelected] = useState('');
  useEffect(() => {
    if (logged) {
      api('/resumes').then(setResumes);
      api('/interviews').then(setInterviews);
    }
  }, [logged]);
  if (!logged) return <Auth onLogin={() => setLogged(true)} />;
  async function upload() {
    const d = await api('/resumes', {
      method: 'POST',
      body: JSON.stringify({
        fileName: 'resume.txt',
        contentType: 'text/plain',
        text,
        disclosureConsent: true,
        noticeVersion: 'resume-glm-v1',
      }),
    });
    setResumes([d, ...resumes]);
    setTab('home');
  }
  async function start() {
    const d = await api('/interviews', {
      method: 'POST',
      body: JSON.stringify({ resumeId: selected, position, questionCount: 5 }),
    });
    setInterviews([d, ...interviews]);
    setTab('interview');
  }
  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow">AI INTERVIEWER</p>
          <h1>面试训练场</h1>
        </div>
        <button
          className="ghost"
          onClick={() => {
            localStorage.removeItem('token');
            setLogged(false);
          }}
        >
          退出
        </button>
      </header>
      <nav>
        <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}>
          概览
        </button>
        <button className={tab === 'resume' ? 'active' : ''} onClick={() => setTab('resume')}>
          简历
        </button>
        <button className={tab === 'interview' ? 'active' : ''} onClick={() => setTab('interview')}>
          开始面试
        </button>
      </nav>
      {tab === 'home' && (
        <section className="grid">
          <article className="hero card">
            <p className="eyebrow">REAL API MVP</p>
            <h2>
              把每一次练习，
              <br />
              变成下一次进步。
            </h2>
            <p className="muted">上传简历，选择岗位，使用 GLM 完成结构化面试。</p>
            <button onClick={() => setTab('resume')}>上传简历 →</button>
          </article>
          <article className="card">
            <p className="eyebrow">历史面试</p>
            <h3>{interviews.length} 次训练</h3>
            {interviews.slice(0, 4).map((i) => (
              <div className="row" key={i.id}>
                <span>{i.position}</span>
                <small>{i.status}</small>
              </div>
            ))}
          </article>
        </section>
      )}
      {tab === 'resume' && (
        <section className="card form">
          <h2>添加简历</h2>
          <p className="muted">仅在你单独勾选同意后，简历文本会发送给 GLM 用于生成面试题。</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="粘贴简历文本（至少 20 字）"
          />
          <label className="check">
            <input type="checkbox" defaultChecked />
            我同意将简历文本发送给 GLM，仅用于本次面试训练（通知版本 resume-glm-v1）
          </label>
          <button onClick={upload} disabled={text.length < 20}>
            保存简历
          </button>
        </section>
      )}
      {tab === 'interview' && (
        <section className="card form">
          <h2>开始一次新面试</h2>
          <label>
            选择简历
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">请选择</option>
              {resumes.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.fileName}
                </option>
              ))}
            </select>
          </label>
          <label>
            目标岗位
            <input value={position} onChange={(e) => setPosition(e.target.value)} />
          </label>
          <button onClick={start} disabled={!selected}>
            开始训练
          </button>
        </section>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
