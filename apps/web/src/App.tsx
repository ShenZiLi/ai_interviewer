import { useQuery } from '@tanstack/react-query';
import { DIMS, gradeOf } from '@ai-interviewer/contracts';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:3000';

interface Health { status: string }

async function fetchHealth(): Promise<Health> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json() as Promise<Health>;
}

/** 演示：用共享契约的八维给一行示例分，展示整体分与等级。 */
const exampleDimScores = [3, 4, 3.5, 3, 3, 4, 4, 4];

export function App() {
  const { data, error, isLoading } = useQuery({ queryKey: ['health'], queryFn: fetchHealth });
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 720 }}>
      <h1>AI 面试教练 · Web</h1>
      <p>契约包健康：{isLoading ? '…' : error ? `失败 ${String(error)}` : data?.status}</p>
      <section>
        <h2>共享契约验证（@ai-interviewer/contracts）</h2>
        <p>示例八维分（0–5）：{exampleDimScores.join(' / ')}</p>
        <ul>
          {DIMS.map((dim, i) => (
            <li key={dim}>{dim}: <b>{exampleDimScores[i]}</b></li>
          ))}
        </ul>
        <div style={{ color: '#4B3FE3' }}>
          对应整体分等级示意：{gradeOf(80)}（示例）
        </div>
      </section>
    </main>
  );
}