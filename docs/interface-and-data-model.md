# 接口与数据模型细化（草案）

> 更新时间：2026-09-18 ｜ 状态：待评审 ｜ 上游：[需求与决策](requirements.md)、[系统架构与技术选型](system-architecture.md)
>
> 本文是**接口与数据模型草案**，供评审后进入接口规范。标注「待确认」的条目需用户拍板；其余基于既有需求直接推导。

## 1. 实体关系概览

核心聚合：**Interview（面试）→ Turn（轮/环节）→ 转写/评价/录音**。

```
User
 ├─ UserAccountBinding (wechat_web / wechat_mini / phone / self → 同一 User)
 ├─ Resume(+版本) 1..n
 ├─ Interview 0..n
 │    ├─ InterviewStyle(本场风格)  ┐
 │    ├─ DimSnapshot(量表)         ├─ 开场即锁定快照
 │    ├─ StyleRuleSnapshot(风格规则)│
 │    └─ PromptVersionLock(P01—P10)┘
 │    ├─ Turn 0..n  (phase, 主问题/追问串)
 │    └─ InterviewReport (模拟模式整场)
 ├─ UserStyleSetting(默认风格) / DefaultAudioRetention
 ├─ PromptTemplate(P01—P10) → PromptVersion(草稿/测试/发布/回滚)
```

关联要点（基于需求）：
- 登录提供方与用户解耦：微信 openid（按平台区分 web/小程序）、手机号、自建账号都可绑定到同一 `User`，实现双端共用账号。**待确认**：绑定主导/合并策略（同手机号撞库如何合并）。
- `Interview` 保存**配置快照**而非外键引用：开始面试时锁定模板版本、风格规则、量表，历史面试不因后续版本发布而变化（对应「已开始面试锁定版本」需求）。
- `Turn` 通过 `parentTurnId` 表示追问串；每次作答记录为 `TurnAttempt`（`stage=first|after_hint`），并列展示首次与提示后表现。

## 2. 核心数据模型

### 2.1 User 与账号绑定

| 字段 | 类型 | 说明 |
|---|---|---|
| user.id | UUID | 主键，跨端共用 |
| user.unionId | string? | 微信 unionid（可选，开放平台绑定后可得） |
| user.defaultRetention | enum(request|session|forever) | 录音保留策略；**默认 `session`（会话结束即删）**，用户显式选择才保留 |
| binding.id | UUID | 绑定记录 |
| binding.provider | enum(wechat_web\|wechat_mini\|phone\|self) | 登录提供方 |
| binding.identityKey | string | 微信 openid / 手机号 SHA256 / 用户名（各 provider 语义不同） |
| binding.userId | UUID | 归属 User |

### 2.2 Resume 简历

| 字段 | 类型 | 说明 |
|---|---|---|
| resume.id | UUID | |
| resume.userId | UUID | |
| resume.title | string | 用户命名 |
| resume.source | enum(file_pdf\|file_docx\|file_md\|file_txt\|paste) | 对应一期支持格式 |
| resume.rawText | 正文镜像 | 解析用原料；**仅持久化在自有本地存储**（不外送第三方；含敏感信息，需脱敏/加密处理） |
| resume.status | enum(parsing\|parsed\|confirmed) | 解析状态机 |
| resume.analysis | JSON | P01 结构化理解（教育/经历/技能…），可被用户修正 |
| resume.revision | int | 版本号（多版本管理待需求确认） |

### 2.3 Interview 面试（核心聚合根）

| 字段 | 类型 | 说明 |
|---|---|---|
| interview.id | UUID | |
| interview.userId | UUID | |
| interview.resumeId | UUID? | |
| interview.kind | enum(coach\|mock) | 陪练/模拟 |
| interview.level | enum(junior\|mid\|senior) | |
| interview.targetRole | string | 目标岗位 |
| interview.jdText | string? | 可选 JD |
| interview.directions | string[] | 考察方向（多选） |
| interview.durationTier | enum(15m\|30m\|45m) | 时长档位 |
| interview.status | enum(draft\|prepared\|active\|finished\|archived) | 生命周期 |
| interview.outline | JSON | P04 大纲（阶段/主问题计划） |
| interview.styleSnapshot | JSON | 本场风格配置 |
| interview.rulesSnapshot | JSON | 13 键) 风格规则/量表快照 |
| interview.promptLocks | JSON | {taskCode: versionId} P01—P10 锁定 |
| interview.report | JSON? | P10 复盘报告（整场） |

### 2.4 Turn 轮 / 环节

| 字段 | 类型 | 说明 |
|---|---|---|
| turn.id | UUID | |
| turn.interviewId | UUID | |
| turn.phase | enum(intro\|tech\|biz\|hr) | 环节 |
| turn.seqNo | int | 环节内序号 |
| turn.parentTurnId | UUID? | 追问关系（null=主问题） |
| turn.question | JSON | 系统问题 {text, ttsRef?} |
| turn.attempts | TurnAttempt[] | 作答子记录（首次/提示后并存） |
| turn.createdAt | datetime | |

**TurnAttempt（作答子记录）**：一次作答即一条。

| 字段 | 说明 |
|---|---|
| attempt.stage | enum(first\|after_hint) |
| attempt.userTranscript | ASR 转写 |
| attempt.audioRef | 录音引用（保留策略决定持久化） |
| attempt.evaluationId | 陪练即时评价（P07） |

### 2.5 Evaluation 评价

| 字段 | 类型 | 说明 |
|---|---|---|
| evaluation.id | UUID | |
| evaluation.turnId / interviewId | UUID | 陪练按 Turn、模拟按整场 |
| evaluation.dims | JSON | 量表各维度 {dim, score, evidence, reason, gap} |
| evaluation.overall / grade | JSON | 汇总/档位 |
| evaluation.suggestion | string | 优化建议 |
| evaluation.confidence | number | 置信度 |
| evaluation.flags | enum[] | 如 asr_error / knowledge_error / not_covered |

### 2.6 提示词模板与版本

| 表 | 关键字段 | 说明 |
|---|---|---|
| prompt_template | id, taskCode(P01—P10), name, description, basePrompt, variables | 模板主记录 |
| prompt_version | id, templateId, versionNo, content, status(draft\|tested\|published\|rolled_back), basedOnId, testResult?, createdBy, createdAt | 版本；发布/回滚均产生新版本 |
| test_case | id, templateId, input, expected, runCount | 测试用例集（正式化待需求） |

### 2.7 外部对象（录音 / TTS）

| 字段 | 说明 |
|---|---|
| object.ref | 存储引用（OSS/CDN 键） |
| object.bucket / mime / size / durationMs | 元信息 |
| object.retention | 保留策略（request\|session\|forever\|none） |

## 3. 接口草案（REST / JSON）

> 鉴权：登录后返回会话令牌（双端通用），后续请求携带。微信相关回调在服务端完成 `code2Session` / OAuth，**openid 不返回客户端**。管理器接口含单一管理员角色。
>
> **接口风格（已决策）：一期采用 REST / JSON，不使用 WebSocket**。依据：手动分轮交互、小程序 WS 并发受限、实时链路仅 Web 端可选增强。对「开始/结束作答」等实时性场景，用 **SSE 增量** 返回（如转写流、评价逐步到达），避免长连与轮询。后续若启用端到端实时通道再单独评估。

### 3.1 身份与账号

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/wechat-mini` | 小程序 code → 换取 openid 绑定登录 |
| POST | `/auth/wechat-web` | Web 扫码 OAuth code → 登录 |
| POST | `/auth/sms` | 手机号短信码登录（预留） |
| POST | `/auth/self` | 账号密码登录（兜底） |
| GET | `/auth/me` | 当前用户与绑定 |
| POST | `/auth/bind` | 绑定/合并另一提供方身份 |

### 3.2 简历

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/resumes/import` | multipart 上传文件 → 解析任务 |
| POST | `/resumes` | 粘贴文本 |
| GET | `/resumes/:id` | 含结构化分析 |
| PATCH | `/resumes/:id` | 用户修正结构化结果 |
| POST | `/resumes/:id/confirmed` | 确认，供新建面试 |

### 3.3 面试流程（对应 P01—P10 触发点）

| 方法 | 路径 | 触发任务 |
|---|---|---|
| POST | `/interviews` | 创建（附 resumeId + 岗位/JD） |
| POST | `/interviews/:id/analyze` | P01 简历理解 + P02 岗位分析 |
| POST | `/interviews/:id/directions` | P03 方向推荐（返回多选+推荐依据） |
| POST | `/interviews/:id/outline` | P04 生成大纲 |
| POST | `/interviews/:id/start` | 锁定配置快照，进入面试室 |
| POST | `/interviews/:id/turns` | P06 开始一道主问题 |
| POST | `/interviews/:id/turns/:tid/replay` | 重答（记录首次/提示后） |
| POST | `/interviews/:id/outline/adjust` | P05 自我介绍后大纲调整（陪练需确认/模拟自动） |
| POST | `/interviews/:id/finish` | P10 整场报告（模拟统一评价） |
| GET | `/interviews/:id/report` | 复盘报告 |
| GET | `/interviews` | 历史列表 / 跨端恢复最近回答 |

### 3.4 作答与录音

- `POST /turns/:tid/answer`：提交转写文本 + 可选录音引用。
  - 陪练：服务端调 P07 即时评价、P08 追问决策，一次返回评价+下一问。
  - 模拟：仅记录转写，不即时评分，结束时 P10 统一评价。
- `POST /files/audio`：上传录音（multipart），返回 `audioRef` 供转写/持久化；国内下载通过「下载音频」接口给前端播放。

### 3.5 语音 / 模型编排（服务端内部）

| 能力 | 接口 | 返回 |
|---|---|---|
| ASR | `asr(audioRef/fileUri) → {text, segments, confidence, lang}` | 转写文本 |
| TTS | `tts(text, voice) → {audioRef/stream, durationMs}` | 合成音频 |
| 编排 | `compose(interviewId, taskCode, stageInput) → structuredJson` | 依任务模板组合上下文，返回结构化 JSON |

`compose` 核心：入参 = 模板版本(锁定) + 风格规则(锁定) + 量表(锁定) + 面试上下文(简历/大纲/最近转写) + 本场输入；出参由程序校验结构（对应「输出结构校验由程序负责」）。

## 4. 结构化输出草案（P07 评价举例）

```jsonc
{
  "taskCode": "P07",
  "grade": "B+",
  "dims": [
    { "dim": "切题与完整性", "score": 4, "reason": "覆盖 Java 并发主要点", "gap": "未给出线下案例",
      "evidence": ["引用用户原话片段", "引用简历经历"] }
  ],
  "corrects": [ { "user":"…", "noteLeft":"专家纠正", "noteKind":"knowledge|asr" } ],
  "suggestion": "建议补充内存模型与锁的取舍",
  "confidence": 0.82,
  "flags": []
}
```

> P01—P10 各自的输出骨架、字段枚举与校验规则，在评审通过后逐任务定义到接口规范。

## 5. 已确认决策

1. **简历原始文本**：仅持久化在**自有本地存储**，不外送第三方；处理时脱敏/加密。
2. **Turn 的首次/获提示后**：同一道 Turn 一条记录，用 **`attempts` 子记录**区分首次与提示后（不拆成两条 Turn）——保持追问链表与环节序号稳定。
3. **陪练重答语义**：同一量表对每次作答**分别评分、并列展示**「首次/提示后」；保留首次分为对照，**不以提示后最高分计入**成绩口径。
4. **录音保留默认值**：个人主体版默认 **`session`（会话结束即删）**；保存需用户显式选择。默认不长期保存。
5. **接口风格**：一期 **REST / JSON，无 WebSocket**；实时性场景用 SSE 增量。

> 实现期进一步细化：管理员账号锚点、测试用例集与通过条件、版本发布粒度的实现细节（承接 [prompt-management 后续技术设计](prompt-management.md)）。

## 6. 推进顺序建议

1. 逐任务定义 P01—P10 输出 JSON Schema 与服务端校验规则。
2. 生成接口规范（每个端点入参/出参/错误码/鉴权）。
3. 据此进入里程碑实现的开发验收标准。