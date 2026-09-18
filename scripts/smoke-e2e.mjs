#!/usr/bin/env node
/**
 * ai_interviewer 端到端回归冒烟（REST / mock 供应商）。
 *
 * 依赖：Node ≥ 20（内置 fetch），服务端需已在运行（默认 http://127.0.0.1:3000，
 * 可用环境变量 API_BASE 覆盖）。以「真实 HTTP 请求 + 断言」驱动 P01—P10 全流程，
 * 覆盖模式隔离、录音保留、删除即弃、状态机防护、P10 高亮等关键路径。
 *
 * 运行：pnpm smoke:e2e
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000';

let passed = 0;
let failed = 0;
const failures = [];

/** 带状态码断言的请求助手：期望 2xx，返回解析后的 JSON body。 */
async function req(method, path, body, expectStatus) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? { connection: 'close' } : { 'content-type': 'application/json', connection: 'close' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (expectStatus !== undefined && res.status !== expectStatus) {
    throw new Error(`${method} ${path} → 期望 ${expectStatus}，实际 ${res.status}：${await res.text()}`);
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = JSON.parse(text)?.error?.message ?? text;
    } catch { /* 非 JSON 错误体 */ }
    throw new Error(`${method} ${path} → HTTP ${res.status}：${msg}`);
  }
  return res.json();
}

/** 创建一条已就绪（大纲已生成、未开考）的面试。 */
async function readyInterview({ kind = 'coach', keepAudio = false, directions } = {}) {
  const r = await req('POST', '/resumes', { title: '冒烟简历', text: '三年 Java 后端，负责订单与库存扣减。' }, 201);
  const resumeId = r.resume.id;
  const created = await req('POST', '/interviews', { resumeId, targetRole: 'Java 后端工程师', level: 'mid', kind, durationTier: '30m', keepAudio }, 201);
  const id = created.interview.id;
  await req('POST', `/interviews/${id}/analyze`, {}, 201);
  await req('POST', `/interviews/${id}/directions`, directions ? { selectedDirections: directions } : {}, 201);
  await req('POST', `/interviews/${id}/outline`, {}, 201);
  return { id, resumeId };
}

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log(`冒烟目标：${BASE}`);
  if (!(await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false))) {
    console.error('✗ 服务端未就绪，请先启动 pnpm --filter @ai-interviewer/server start');
    process.exit(1);
  }

  console.log('\n[1] 陪练模式全流程（P01→P10）');
  {
    const { id } = await readyInterview({ directions: ['concurrency'] });
    const started = await req('POST', `/interviews/${id}/start`, {}, 201);
    check('start 记录 startedAt', !!started.interview.startedAt);

    const turn1 = (await req('POST', `/interviews/${id}/turns`, { phase: 'tech' }, 201)).turn;
    check('主问题带出题元信息', !!turn1.topic && ['begin', 'mid', 'deep'].includes(turn1.difficulty) && !!turn1.targetAspect, `「${turn1.topic}」/ ${turn1.difficulty}`);

    const a1 = await req('POST', `/interviews/${id}/turns/${turn1.id}/answer`, { transcript: '先明确部署边界，再考虑分布式锁并做好幂等设计，补充失败处理。', stage: 'first' }, 201);
    check('陪练作答返回八维评价', typeof a1.evaluation?.score === 'number' && a1.evaluation.dims.length >= 1 && !!a1.next, `score=${a1.evaluation.score}`);
    const followText = a1.next.questions?.[0]?.text;

    const coaching = await req('POST', `/interviews/${id}/turns/${turn1.id}/coaching`, {}, 201);
    check('P09 辅导返回示范结构', !!coaching.coaching.modelAnswer?.summary && coaching.coaching.modelAnswer.structure.length >= 1);

    const fu = (await req('POST', `/interviews/${id}/turns`, { phase: 'tech', parentTurnId: turn1.id }, 201)).turn;
    check('追问轮复用 P08 追问文本', followText ? fu.question === followText : true, fu.parentTurnId === turn1.id ? 'parent 挂接正确' : 'parent 缺失');

    const turn2 = (await req('POST', `/interviews/${id}/turns`, { phase: 'tech' }, 201)).turn;
    await req('POST', `/interviews/${id}/turns/${turn2.id}/answer`, { transcript: '直接给出结论，但缺少前提与约束说明。', stage: 'first' }, 201);

    const fin = await req('POST', `/interviews/${id}/finish`, {}, 201);
    const report = fin.report;
    check('整场报告八维完整', report.dimensionReport.length === 8);
    check('avgScore 落在 0–100', report.overview.avgScore >= 0 && report.overview.avgScore <= 100, `${report.overview.avgScore}`);
    check('方向覆盖 ≤ 计划', report.overview.directionCoverage.covered <= report.overview.directionCoverage.planned, `${report.overview.directionCoverage.covered}/${report.overview.directionCoverage.planned}`);
    const realTurnIds = new Set([turn1.id, turn2.id]);
    const hl = report.highlight;
    check('P10 高亮指向真实轮次 id', !!hl && realTurnIds.has(hl.bestAnswer.turnRef) && realTurnIds.has(hl.improvementStart.turnRef), `best=${hl?.bestAnswer.why ?? '-'} / improve=${hl?.improvementStart.why ?? '-'}`);

    const detail = await req('GET', `/interviews/${id}`, undefined, 200);
    const attempts = detail.interview.turns.find((t) => t.id === turn1.id)?.attempts ?? [];
    check('同轮多次作答以 attempts 记录', attempts.length === 1 && attempts[0].stage === 'first');
  }

  console.log('\n[2] 模拟模式：静默评估 + 真实作答复盘');
  {
    const { id } = await readyInterview({ kind: 'mock' });
    await req('POST', `/interviews/${id}/start`, {}, 201);
    const t = (await req('POST', `/interviews/${id}/turns`, { phase: 'tech' }, 201)).turn;
    const ans = await req('POST', `/interviews/${id}/turns/${t.id}/answer`, { transcript: '只记录不反馈。', stage: 'first' }, 201);
    check('模拟作答不返回即时评价', ans.recorded === true && ans.evaluation === undefined);
    const detail = await req('GET', `/interviews/${id}`, undefined, 200);
    const stored = detail.interview.turns.find((x) => x.id === t.id)?.attempts?.[0];
    check('模拟作答静默存档转写与评价', stored?.transcript === '只记录不反馈。' && !!stored?.evaluation);
    const fin = await req('POST', `/interviews/${id}/finish`, {}, 201);
    check('模拟整场报告反映实测作答', fin.report.overview.completedAnswers === 1 && fin.report.dimensionReport.length >= 1);
  }

  console.log('\n[3] 大纲调整模式隔离（教练需确认 / 模拟自动应用）');
  {
    const coach = await readyInterview({ kind: 'coach' });
    await req('POST', `/interviews/${coach.id}/start`, {}, 201);
    await req('POST', `/interviews/${coach.id}/outline/adjust`, {}, 201);
    let got = await req('GET', `/interviews/${coach.id}`, undefined, 200);
    check('陪练未确认不应用调整', got.interview.outlineAdjustedAt === undefined);
    await req('POST', `/interviews/${coach.id}/outline/adjust`, { confirm: true }, 201);
    got = await req('GET', `/interviews/${coach.id}`, undefined, 200);
    check('陪练确认后应用调整', !!got.interview.outlineAdjustedAt);

    const mock = await readyInterview({ kind: 'mock' });
    await req('POST', `/interviews/${mock.id}/start`, {}, 201);
    await req('POST', `/interviews/${mock.id}/outline/adjust`, {}, 201);
    got = await req('GET', `/interviews/${mock.id}`, undefined, 200);
    check('模拟未确认自动应用调整', !!got.interview.outlineAdjustedAt);
  }

  console.log('\n[4] 状态机防护与录音保留');
  {
    const { id } = await readyInterview();
    await req('POST', `/interviews/${id}/start`, {}, 201);
    const turn = (await req('POST', `/interviews/${id}/turns`, { phase: 'tech' }, 201)).turn;
    await req('POST', `/interviews/${id}/turns/${turn.id}/answer`, { transcript: 'x', stage: 'first' }, 201);
    await req('POST', `/interviews/${id}/finish`, {}, 201);
    try {
      await req('POST', `/interviews/${id}/turns/${turn.id}/answer`, { transcript: 'y', stage: 'first' }, 201);
      check('结束后作答返回 409', false, '未拦截');
    } catch (e) {
      check('结束后作答返回 409', /409/.test(e.message), e.message);
    }
    await req('DELETE', `/interviews/${id}`, undefined, 200);
    try {
      await req('GET', `/interviews/${id}`, undefined, 200);
      check('删除后查询 404', false, '仍可访问');
    } catch (e) {
      check('删除后查询 404', /404/.test(e.message), e.message);
    }

    const kept = await readyInterview({ keepAudio: true });
    const got = await req('GET', `/interviews/${kept.id}`, undefined, 200);
    check('keepAudio 偏好持久化', got.interview.keepAudio === true);

    const r0 = await req('POST', '/resumes', { title: '冒烟简历', text: '三年 Java 后端。' }, 201);
    const noOutline = await req('POST', '/interviews', { resumeId: r0.resume.id, targetRole: 'Java 后端', level: 'mid', kind: 'coach' }, 201);
    try {
      await req('POST', `/interviews/${noOutline.interview.id}/start`, {}, 201);
      check('未生成大纲直接开始 → 409', false, '未拦截');
    } catch (e) {
      check('未生成大纲直接开始 → 409', /409/.test(e.message), e.message);
    }

    const withJd = await req('POST', '/interviews', { resumeId: r0.resume.id, targetRole: 'Java 后端', level: 'mid', kind: 'coach', jdText: '要求熟悉高并发与分布式事务' }, 201);
    const jdDetail = await req('GET', `/interviews/${withJd.interview.id}`, undefined, 200);
    check('可选 JD 文本持久化到面试详情', jdDetail.interview.jdText === '要求熟悉高并发与分布式事务');
    await req('POST', `/interviews/${withJd.interview.id}/directions`, { extra: '更看重原理深度' }, 201);
    check('补充诉求 extra 被方向接口接受', true);
  }

  console.log('\n[5] 趋势数据源：不同作答 → 整场综合分不同');
  {
    const runScore = async (transcript) => {
      const { id } = await readyInterview();
      await req('POST', `/interviews/${id}/start`, {}, 201);
      const t = (await req('POST', `/interviews/${id}/turns`, { phase: 'tech' }, 201)).turn;
      await req('POST', `/interviews/${id}/turns/${t.id}/answer`, { transcript, stage: 'first' }, 201);
      const fin = await req('POST', `/interviews/${id}/finish`, {}, 201);
      return fin.report.overview.avgScore;
    };
    const a = await runScore('我会考虑分布式锁并做好幂等。');
    const b = await runScore('先给结论再给约束。');
    check('综合分随作答分化', a !== b, `${a} vs ${b}`);
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed) {
    console.error(`失败项：${failures.join('、')}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`✗ 冒烟异常中断：${e.message}`);
  process.exit(1);
});
