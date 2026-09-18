# Real API MVP Design

> 日期：2026-09-18
> 状态：已批准（用户确认方案 1，并授权后续按推荐方案自主决策直至完成 MVP）

## 1. 目标

交付一个可本地运行的 Web MVP：用户以用户名和密码注册登录，导入或粘贴简历，在明确同意将简历必要文本发送给 GLM 后，完成面试准备、真实语音问答、陪练/模拟模式、追问与复盘报告；用户、简历、面试、轮次、评价和报告保存到 PostgreSQL，刷新后可恢复。

## 2. 已批准的产品边界

### MVP 包含

- Web 单端，专业简洁浅色界面，复用现有静态原型的信息架构与视觉语言。
- 用户名 + 密码自助注册/登录；Argon2id 密码哈希；JWT Bearer 鉴权。
- PostgreSQL + Prisma 持久化。
- PDF、DOCX、Markdown、TXT 和粘贴文本简历解析；不做扫描 PDF OCR。
- 简历第三方处理的最小披露与单独勾选；授权时间和说明版本落库。
- GLM 统一提供文本生成、ASR 与 TTS。
- 陪练和模拟两种模式；15/30/45 分钟档位。
- P01—P10 任务模板、Zod 输出校验、一次修复重试和可解释降级。
- 面试恢复、历史列表和已完成报告查看。

### MVP 不包含

- 微信小程序、微信扫码、短信登录、跨端账号绑定。
- 提示词管理后台；模板随代码发布并锁定版本标识。
- 扫描 PDF OCR、简历多版本管理、录音长期保留。
- 端到端 Realtime 长连接、连续自由对话、在线编程题。

## 3. 总体方案

采用纵向切片的模块化单体：

```text
React Web
  ├─ auth        注册 / 登录 / 当前用户
  ├─ resumes     导入 / 授权 / 确认
  ├─ interviews  准备 / 大纲 / 面试室 / 恢复
  └─ reports     历史 / 复盘
       │ REST + multipart + audio responses
NestJS + Fastify
  ├─ auth        Argon2id + JWT + ownership guard
  ├─ resumes     文件提取 + 加密存储 + P01
  ├─ interviews  状态机 + P02—P10 编排
  ├─ providers   GLM text / ASR / TTS adapters
  └─ persistence Prisma repositories
       │
PostgreSQL
```

前后端只共享 `packages/contracts` 中的 Zod DTO、枚举与 P01—P10 输出结构。业务模块不直接依赖 GLM HTTP 细节，而依赖 `TextModelPort`、`SpeechToTextPort`、`TextToSpeechPort`。MVP 是单进程服务，但模块边界允许后续把模型编排或音频处理拆成独立服务。

## 4. 仓库结构

```text
apps/
  server/
    prisma/schema.prisma
    src/
      auth/
      resumes/
      interviews/
      reports/
      providers/glm/
      common/
  web/
    src/
      app/
      features/auth/
      features/resumes/
      features/interviews/
      features/reports/
      shared/
packages/
  contracts/
    src/auth.ts
    src/resume.ts
    src/interview.ts
    src/prompts/p01.ts ... p10.ts
    src/index.ts
schemas/
  p01.json ... p10.json
```

每个服务端功能目录包含 controller、service、repository 接口/实现和相邻测试；前端按用户功能而非技术层拆分。

## 5. 数据模型

### 身份

- `User`: `id`, `defaultRetention`, `createdAt`, `updatedAt`。
- `Credential`: `id`, `userId`, `username`（唯一、规范化小写）、`passwordHash`, `createdAt`。

### 简历

- `Resume`: `id`, `userId`, `title`, `source`, `rawTextEncrypted`, `status`, `analysisJson`, `glmConsentAt`, `glmNoticeVersion`, timestamps。
- 上传文件只在内存中提取文本；原文件不长期保存。原文用 AES-256-GCM 加密后落库，密钥来自 `DATA_ENCRYPTION_KEY`。

### 面试

- `Interview`: 用户、简历、目标岗位/JD、级别、模式、时长、方向、风格快照、模板版本、量表版本、状态、当前阶段、当前轮次、大纲 JSON、timestamps。
- `Turn`: 面试、阶段、序号、问题 JSON、状态、追问层级、TTS 音频（MVP 临时返回，不持久化）。
- `Attempt`: Turn、`first|after_hint`、转写、ASR 置信度、评价 JSON、创建时间。
- `Report`: interviewId（唯一）、P10 JSON、创建时间。

所有资源查询必须同时带 `userId`，以数据库条件实现属主隔离，而不是查询后再判断。

## 6. 状态机与数据流

### 6.1 登录

1. 注册校验用户名和密码强度。
2. Argon2id 计算哈希，在事务中创建 `User + Credential`。
3. 返回短期 JWT；Web 保存在 `localStorage`，请求使用 `Authorization: Bearer`。
4. `/auth/me` 校验恢复登录态；401 时清除本地令牌并回登录页。

### 6.2 简历

1. 用户选择文件或粘贴文本并勾选 `resume-glm-v1` 授权。
2. 服务端拒绝缺失授权的请求；提取文本、限制大小/长度、加密落库。
3. 调用 P01；输出经过 Zod 校验并落库，状态 `parsing → parsed`。
4. 用户修正结构化内容后确认，状态 `parsed → confirmed`。

限制：文件最大 5 MB；提取后文本最大 100,000 字符；空文本、加密 PDF、损坏 DOCX 返回明确错误；扫描 PDF 提示 MVP 不支持 OCR。

### 6.3 准备与开始

1. 创建 draft 面试，写入已确认简历、岗位、JD、级别、模式和时长。
2. P02 分析岗位，P03 返回推荐方向，用户选择后 P04 生成大纲。
3. 开始时锁定模板版本 `mvp-v1`、量表 `rubric-v1` 和风格快照，状态进入 `active`。
4. P06 生成当前主问题；服务端调用 TTS，浏览器播放返回的 WAV。

### 6.4 作答

1. Web 使用 `MediaRecorder` 手动开始/结束录音，优先请求 `audio/webm`；提交前转码不在 MVP 内，因此浏览器若不能生成 GLM 支持的 WAV/MP3，则在前端使用 Web Audio API 导出单声道 WAV。
2. GLM-ASR 单次限制 30 秒，前端每 25 秒自动切段；服务端逐段调用 `/audio/transcriptions`，按顺序拼接文本，并把前段文本作为后段 prompt。
3. 保存 Attempt；陪练模式调用 P07、P08、P09 并返回即时反馈，模拟模式只保存转写并计算下一问，不向前端返回评分。
4. 自我介绍后调用 P05：陪练待用户确认再应用，模拟自动应用；只修改未开始节点。
5. 结束时 P10 生成并保存报告，Interview 状态 `finished`。

## 7. GLM 集成

统一基址默认 `https://open.bigmodel.cn/api/paas/v4`，全部通过环境变量覆盖：

- 文本：`POST /chat/completions`，默认模型 `glm-5.3-flash`，`response_format={"type":"json_object"}`。
- ASR：`POST /audio/transcriptions`，默认 `glm-asr-2512`，WAV/MP3，单段 ≤25 MB 且 ≤30 秒。
- TTS：`POST /audio/speech`，默认 `glm-tts`、`tongtong`、WAV。

`GlmTextClient` 只负责 HTTP、超时、错误归一和提取文本；`PromptOrchestrator` 负责模板组合、JSON 解析、Zod 校验、一次修复重试和落库。模型 ID 不写死在业务代码。

### 输出处理

1. 首次请求使用 `json_object`。
2. JSON 解析后用对应 P01—P10 Zod schema 校验。
3. 失败时把精简后的校验错误和原始输出交给同一模型修复一次。
4. 仍失败则返回 `UPSTREAM_UNAVAILABLE`，记录任务码、请求 ID、错误类别和耗时；不记录简历、回答或模型正文。

## 8. 前端体验

- 登录/注册页：同页切换，成功后进入工作台。
- 工作台：开始新面试、恢复最近进行中面试、查看历史报告。
- 简历页：导入/粘贴、最小披露勾选、解析进度、结构化结果修正与确认。
- 准备页：目标岗位/JD、级别、方向、模式、时长、风格；生成大纲后确认开始。
- 面试室：沿用原型三栏；左侧流程，中间问题/录音/转写，右侧陪练反馈；模拟模式右栏隐藏即时评价。
- 报告页：整体分、八维评分、证据、优势、薄弱项和训练计划。
- 设置页：MVP 只显示当前 GLM 配置状态和数据说明，不允许浏览器保存 API Key。

加载、空状态、上游错误和恢复入口必须在页面内呈现；模型调用中按钮不可重复提交。

## 9. 错误处理与幂等

- 统一错误信封 `{ error: { code, message, details? } }`。
- 创建、提交答案和结束面试支持 `Idempotency-Key`；数据库保存最近结果，重复请求返回相同响应。
- 状态机拒绝越序操作，返回 `CONFLICT_STATE`。
- GLM 401/403 → 配置错误；429 → 限流并提示稍后重试；5xx/超时 → 最多一次带抖动重试。
- 文件格式、大小、空文本、录音过长和浏览器麦克风拒绝分别提供可操作提示。
- 断网或刷新后从 `/interviews?status=active` 和面试详情恢复到最近已完成的 Attempt；正在录制但未提交的本地音频不保证恢复。

## 10. 安全与隐私

- `.env`、密钥、真实简历、音频和日志不提交 Git。
- GLM Key 仅存在服务端；前端没有自定义 Key 输入。
- 密码 Argon2id；JWT 使用强随机密钥，默认 2 小时有效。
- 简历原文 AES-256-GCM 加密；日志拦截 `password`、`token`、`rawText`、`transcript`、`audio`、模型消息。
- Resume、Interview、Turn、Report 均执行属主过滤。
- 简历 GLM 授权未接受时服务端不调用模型；授权版本与时间可审计。
- 模型输出只渲染 Zod 校验后的字段，React 默认转义，不注入 HTML。

## 11. 测试策略

### 单元测试

- P01—P10 schema、评分权重和 grade 边界。
- 面试状态机、模式隔离、自我介绍后的大纲调整。
- Argon2id、JWT、数据加解密和属主条件。
- GLM 错误归一、JSON 修复重试、ASR 分段拼接。

### 集成测试

- PostgreSQL/Prisma：注册、唯一用户名、恢复面试、报告持久化。
- Supertest：鉴权、越权 403、状态冲突、简历授权、完整 REST 契约。
- GLM 使用本地 HTTP stub 验证真实请求路径、请求体、multipart 和二进制 TTS 响应，不消耗额度。

### 端到端测试

- 浏览器流程：注册 → 简历粘贴并授权 → 确认 → 准备 → 开始 → 提交示例 WAV → 陪练反馈 → 结束 → 报告 → 刷新恢复。
- 模拟模式断言过程中不显示评分，结束后报告可见。

### 真实服务冒烟

仅在设置 `GLM_API_KEY` 时运行单独的 `test:live:glm`，调用最短文本、短 WAV 和短 TTS，验证凭据、模型 ID 与官方接口兼容；默认测试永不消耗真实额度。

## 12. 交付顺序

1. Monorepo、共享契约和工程质量门禁。
2. Prisma 数据模型、加密与用户名密码鉴权。
3. 简历导入、授权、解析和 P01。
4. GLM 文本编排 P02—P10 与面试状态机。
5. ASR/TTS 和浏览器录音分段。
6. React 全流程页面与恢复能力。
7. 契约、集成、浏览器冒烟和真实 GLM 可选冒烟。
8. 更新 README、`.env.example`、运行说明与验收记录。

每个步骤先写失败测试，再写最小实现，验证后形成独立本地提交。

## 13. 完成标准

- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:e2e` 全部通过。
- PostgreSQL 中可以看到完整用户/简历/面试/轮次/评价/报告链路。
- 未授权不能分析简历；未登录和跨用户访问被拒绝。
- 陪练/模拟行为隔离正确；P01—P10 输出全部通过契约。
- 配置有效 GLM Key 时，文本、ASR、TTS 真实冒烟通过。
- Git 不含密钥、真实简历或录音；每组改动有本地提交。
