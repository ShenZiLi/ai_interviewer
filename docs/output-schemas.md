# 提示词任务输出 Schema 与校验规则（P01—P10）

> 更新时间：2026-09-18 ｜ 状态：可评审 ｜ 上游：[接口与数据模型](interface-and-data-model.md)、[提示词管理](prompt-management.md)
>
> 定义每个任务模板（P01—P10）的结构化输出。实现时用 JSON Schema 校验器（2020-12）在服务端校验，失败重试一次，仍失败则降级处理——**永不把模型原始输出直接渲染给客户端**。

## 0. 通用约定与安全规则

- **方言**：所有文本字段用规范化简体中文（除姓名/英文技术词）。
- **长度边界**：文本字段设 `maxLength`（主问题 ≤500，理由/建议 ≤300，其余默认 ≤200），用于控 token、防注入与 UI 溢出。
- **明文安全**：仅接受纯文本；输出经清洗（去 HTML/脚本），变量注入模板前先 URL/转义处理。
- **枚举白名单**：`enum` 字段只认白名单值，非法值判失败，不静默猜测。
- **数值范围**：置信度/权重 0–1，评分在量表范围，越界钳制并置低置信标记。
- **证据约束**：`evidence`、`turnRef` 等引用必须指向已存在实体，否则丢弃该条。
- **模式隔离**：P07 评价、P09 辅导、P08 追问提示在**模拟模式不返回给用户**（仅服务端记录），由 P08/P10 据此合成整场评价。
- **置信门控**：`confidence < 0.6` 的输出不得直接用于评级/生成题面，记 `flag: low_confidence`，交人工/降级。

### 通用维度（P07 每轮 / P10 整场共用同一八维量表）

统一维度（顺序即默认展示顺序）：`切题与完整性、专业准确性、分析与推理、方案与取舍、项目深度与贡献、证据与一致性、表达与结构、沟通与反思`。

- **刻度**：单维内部存 `0–5`（可 0.5 步进），展示 ×20 转 0–100；可带 `not_covered` 标记。
- **默认权重（需 admin 量表一致，可被后台覆盖）**：专业准确性 0.20、分析与推理 0.18、方案与取舍 0.17、项目深度与贡献 0.15、证据与一致性 0.08、表达与结构 0.08、切题与完整性 0.07、沟通与反思 0.07，Σ=1。
- **整体分公式**：`score(0-100) = Σ(weight_i × dim_i) × 20`，其中 `dim_i` 为 0–5。
  - 自洽校验：`|score − 加权值| > 8` 置 `flag: self_inconsistent`。
- **等级映射（整体分→grade）**：`≥90 A+ / 80–89 A / 70–79 B+ / 60–69 B / <60 C`。
- **维度口径说明**：全程只用一套八维，单轮与整场口径一致；单轮 UI 可只强调与展示重点维度，但**落库与计分都是八维**，避免出现原型里「单轮4维（如『回答完整性』）」与「整场八维（『切题与完整性』）」两套命名/口径不一致的问题。

---

## P01 简历理解

**用途**：导入简历后，LLM 把原文转成结构化简历，供确认/修正。

**输出 JSON 结构**：

```jsonc
{
  "summary": "一句话候选人画像",
  "candidateName": "张三",
  "education": [ { "school": "…", "degree": "本科", "major": "计算机", "period": "2018-2022" } ],
  "experiences": [ { "company": "…", "role": "后端", "period": "…", "bullets": ["…"] } ],
  "projects": [ { "name": "…", "role": "…", "stack": ["Java","MySQL"], "points": ["…"] } ],
  "skills": [ { "name": "Spring", "level": "进阶" } ],
  "gaps": [ { "field": "项目时间", "note": "未在原文明确" } ],
  "confidence": 0.87
}
```

**校验规则**：`summary`、`education`、`skills`、`confidence` 必填；`education` 非空；`confidence ∈[0,1]`；数组元素均 ≤30 条；`gaps` 可空但非空时字段需填。

---

## P02 目标岗位分析

**用途**：结合岗位/JD（可含简历摘要）产出目标画像，供方向推荐与大纲使用。

```jsonc
{
  "role": "Java 后端工程师",
  "seniority": "mid",
  "requiredSkills": ["Java","并发","分布式"],
  "preferredSkills": ["K8s"],
  "focusAreas": ["高并发设计","分布式事务"],
  "jdRisk": { "missing": ["JD 未给年限"], "conflict": [] },
  "summary": "…",
  "confidence": 0.82
}
```

**校验规则**：`role`、`requiredSkills`(非空，≤15)、`focusAreas`(非空，≤10)、`confidence` 必填；`seniority ∈ {junior,mid,senior}`。

---

## P03 需求澄清与方向推荐

**用途**：准备阶段对话，输出可多选的技术方向及澄清问题。

```jsonc
{
  "recommendedDirections": [
    { "id": "concurrency", "name": "并发/多线程", "weight": 0.9,
      "reason": "岗位与简历均涉高并发", "questions": [ { "q": "…", "why": "…" } ] }
  ],
  "pendingClarify": [ { "question": "倾向项目深挖还是原理考核？", "options": ["原理","项目"], "why": "…" } ],
  "confidence": 0.78
}
```

**校验规则**：`recommendedDirections` 必填且 2–6 项；`id` 唯一、`name` 非空；每个 `weight ∈(0,1]` 且总和归一可钳制；`pendingClarify` 可空。

---

## P04 面试大纲规划

**用途**：按方向选择 + 时长档位 + 风格生成阶段与主问题计划。

```jsonc
{
  "summary": "…",
  "durationPlan": {
    "tier": "30m", "budgetMinutes": 30,
    "phases": [ { "phase": "tech", "minutes": 18, "questionCount": 3, "focus": ["并发"] } ]
  },
  "outline": [ { "topic": "并发控制", "mainQuestion": "…", "difficulty": "mid",
                 "followUpPlan": { "depth": 3, "branches": ["内存模型","锁"] } } ],
  "coveredDirections": ["concurrency"],
  "confidence": 0.8
}
```

**校验规则**：`summary`、`durationPlan.tier`、`outline`(非空 ≤15) 必填；`phases` 时长为整数；**各 phase `minutes` 总和 ≤ `budgetMinutes`**（违反即判失败，回退放宽时长或裁剪 questionCount）；`phase ∈ {intro,tech,biz,hr}`；`difficulty ∈ {begin,mid,deep}`。

---

## P05 自我介绍后大纲调整

**用途**：依据自我介绍新增内容修改后续题目大纲。

```jsonc
{
  "changes": [
    { "type": "add", "ref": "project_x", "before": null, "after": "新增微服务项目深挖", "reason": "介绍含高并发项目" }
  ],
  "newlyNoted": [ { "fact": "熟悉 Kafka", "appliedTo": "tech" } ],
  "mode": "auto",
  "confidence": 0.85
}
```

**校验规则**：`mode` 必填且须与 `interview.kind` 匹配（mock→`auto`，coach 可为 `needsConfirm`）；`mode=needsConfirm` 时，变更仅在用户确认后应用；`changes`/`newlyNoted` 至少其一非空；`changes[].type ∈ {add,modify,remove,reorder}`。

---

## P06 当前主问题生成

**用途**：每道主问题开始前生成题面与考察点。

```jsonc
{
  "questionText": "在线购物结算如何保证不超卖？",
  "topic": "分布式事务",
  "difficulty": "mid",
  "targetAspect": "方案权衡",
  "probePoints": [ { "purpose": "考察取舍", "hint": "关注幂等与最终一致" } ],
  "biasToDirections": ["distributed"],
  "contextUsed": ["简历项目X"],
  "avoidDuplicatesWith": ["上轮已问：××"],
  "confidence": 0.86
}
```

**校验规则**：`questionText` 必填非空 ≤500、以 `？`/`。` 结尾可强制；`difficulty`、`topic` 必填；`probePoints` ≤4；服务端比对新题与 `已提问列表`（`avoidDuplicatesWith`）做**去重检测**，相似度过高触发重试。

---

## P07 回答评价

**用途**：陪练每轮（含追问）评分与反馈。

```jsonc
{
  "overall": "切题但深度不足",
  "grade": "B+",
  "score": 82,
  "dims": [
    { "dim": "分析与推理", "score": 4, "weight": 0.15,
      "reason": "覆盖主要并发点", "gap": "缺线下案例",
      "evidence": ["引用原话片段", "简历项目X"] }
  ],
  "strengths": ["…"], "weaknesses": ["…"],
  "suggestions": [ { "title": "补充取舍", "body": "…" } ],
  "misconceptions": [ { "quote": "…", "clarification": "…", "kind": "knowledge" } ],
  "followUpHint": { "recommended": true, "reason": "深度不足可追问" },
  "confidence": 0.79,
  "flags": []
}
```

**校验规则**：`score`(0–100)、`grade`、`dims`(非空，含至少一个引用已存在证据) 必填；`dims[].dim` 属八维白名单，**重复的 `dim` 判失败**；`score` 与八维加权值（见 §0）偏差 > 8 置 `flag: self_inconsistent`；`misconceptions[].kind ∈ {knowledge, asr, assumption}`；**模拟模式本结构下发隐藏**。

---

## P08 追问决策与生成

**用途**：依据回答与评价决定是否追问、追什么。

```jsonc
{
  "shouldAsk": true,
  "decidedBy": "depth",
  "questions": [ { "text": "如果并发再翻一倍呢？", "purpose": "考察扩容", "difficulty": "deep", "relationToPrev": "加深" } ],
  "maxDepthReached": false,
  "nextStep": "followup",
  "confidence": 0.81
}
```

**校验规则**：`shouldAsk` 与 `nextStep` 一致性（`shouldAsk=true`→`nextStep=followup`；否则→`next_topic|coaching|wrapup`）；`maxDepthReached=true` 时 `questions` ≤1 或空；`questions` 尺寸 0–3、`text ≤500`；`decidedBy ∈ {depth, coverage, answer}`；模拟模式隐藏此输出结构（仅记录决策）。

---

## P09 辅导与答案优化

**用途**：陪练模式给出优化答案与练习建议。

```jsonc
{
  "modelAnswer": { "summary": "…", "structure": [ { "point": "先给结论", "explanation": "…" } ] },
  "optimization": [ { "userPoint": "原话要点", "improved": "…", "why": "…" } ],
  "coachingNote": "语速偏快，建议分点作答",
  "practicePrompt": "可重答一次",
  "confidence": 0.74
}
```

**校验规则**：`modelAnswer.structure` 非空；`optimization` 可空，每条 `improved` 非空；`coachingNote` ≤200；模拟模式不返回。

---

## P10 整场复盘报告

**用途**：整场结束生成报告（模拟模式承载统一评价）。

```jsonc
{
  "overview": {
    "mode": "coach", "directionCoverage": { "covered": 2, "planned": 3 },
    "durationUsedMinutes": 28, "completedAnswers": 4, "avgScore": 78.5
  },
  "dimensionReport": [
    { "dim": "专业准确性", "overallScore": 4, "trend": "up",
      "topStrengths": ["…"], "topGaps": ["…"],
      "evidenceRefs": ["turn:uuid", "attempt:uuid"] }
  ],
  "highlight": { "bestAnswer": { "turnRef": "…", "why": "…" },
                 "improvementStart": { "turnRef": "…", "why": "…" } },
  "actionPlan": [ { "area": "面试表达", "suggestion": "…", "practiceSuggestion": "…", "priority": "high" } ],
  "confidence": 0.83
}
```

**校验规则**：`overview`、`dimensionReport`、`highlight`、`actionPlan` 必填；`dimensionReport[].dim` 覆盖量表维度；`evidenceRefs` 引用的 turn/attempt 存在否则丢弃；`trend ∈ {up, flat, down}`；`priority ∈ {high, mid, low}`；`overview.mode` 须与 `interview.kind` 一致。

---

## 实现落点

- 每个任务配一份 JSON Schema 文件（代码仓 `schemas/`），运行时用校验器校验 `compose` 输出。
- 校验失败 → 重试一次 → 仍失败记 `prompt_output_failed` 并返回“无法生成，请稍后重试”或降级（缺评价时仅存转写）。
- 模式隔离与长度/枚举/证据规则在**编排层**统一实施，模板只负责语义生成，不负责安全边界。

**待评审 / 已确认**：评分口径已定（八维统一、权重偏专业与深度、内部 0–5 展示 0–100、整体分加权、grade 五档、pitch 后 self_inconsistent 阈值 8）。待确认项已收口；若后续调整，仅改 §0 与对应校验即可。