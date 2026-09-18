# 开发规范与验收标准

> 更新时间：2026-09-18 ｜ 状态：供评审 ｜ 上游：[系统架构](system-architecture.md)、[接口规范](api-spec.md)、[输出 Schema](output-schemas.md)、[AGENTS.md](../AGENTS.md)
>
> 前置提醒：进入实现前需先定**应用技术栈**（后端框架/前端框架/数据库），本规范保持技术栈中立；相关落点标注「随选型」。下一个待决策即在文末。

## 1. 分支与提交规范

- **分支**：日常开发在 `dev-trae`；新功能可在 `dev-trae` 上开短期分支，完成后合并回 `dev-trae`。主干 `dev` 为集成分支，`main` 仅发布。
- **提交**：
  - 采用 Conventional Commits：`type(scope): subject`，type ∈ {feat, fix, docs, refactor, test, chore, design, build}。
  - **每次一组有意义的改动后本地提交**，不自动推送远端。
  - 提交前检查暂存内容；**不提交** API 秘钥、真实简历、录音、`.env`、凭据类文件。
  - 不做 force push。
- **Commit 组织**：按「一次提交一个逻辑变更」拆分；样式示例：
  - `feat: implement P01 resume understanding endpoint`
  - `fix: correct overall score weighted computation`
  - `docs: add M1 acceptance criteria`

## 2. 契约与代码布局

- **契约先行**：接口与输出 Schema 已有规范（`api-spec.md` / `output-schemas.md`）。实现前将每个端点和 P01—P10 输出固化为**契约文件**（OpenAPI + JSON Schema），纳入仓库 `schemas/`。
- **校验落点**：模型输出（`compose`）必须经 `schemas/` 里的 JSON Schema 校验，`validate + repair + retry + degrade` 流程在**编排层**统一实现，不散落到业务代码。
- **命名**：接口/表名用 snake_case，JSON 域用 camelCase；枚举集中定义，禁止魔数。
- **配置**：模型/语音供应商、密钥、域名等走环境变量与配置中心；`.env.example` 供应商列表，真实 `.env` 进 `.gitignore`。

## 3. 测试标准（TDD 导向）

- **原则**：先写能证明行为缺失的失败测试，再实现，再验证 green。参考 AGENTS「分阶段实现，每次改动检查」。
- **层级**：
  1. 单元测试：Schema 校验、状态机、评分计算（权重/grade 映射）、错误码。
  2. 契约/集成测试：端点入参出参与 `api-spec` 对齐；`compose` 输出经过 Schema。
  3. 端到端冒烟：走过一整个面试最小闭环。
- **必须覆盖的边界**：`score` 与加权值偏差自洽、`grade` 区间边界（89/90）、模式隔离（陪练 vs 模拟）、录音保留策略、权限（非属主 403、非管理员 403）。
- **验证命令**：每个里程碑定义明确命令（如 `npm test` / 单测 + 契约校验 + lint），**未跑通不声称完成**。

## 4. 安全性

- **凭据**：不提交密钥；`.env` 忽略；日志脱敏（不打印 token/openid/简历全文）。
- **敏感数据**：简历原始文本仅本地存储、需加密；录音默认 `session`（会话结束删）；openid 不下发客户端。
- **权限**：服务端统一校验属主与 `role=admin`；管理员操作留审计（`createdBy` + 时间 + 前后版本）。
- **供应商输出**：窗口内 sanitize（去 HTML/脚本）、长度限制、枚举白名单，永不直接渲染模型原始输出。

## 5. 里程碑 1（M1）：Web 单端最小闭环

**范围**：Web 端打通 `简历导入 → P01→P02→P03→P04 → 自我介绍 → P06 主问题 → 作答转写 P07 → 陪练评价 → P08 追问 → P10 报告`，**级联链路**（ASR→文本LLM→TTS），默认 GLM 语音 + 选定的文本 LLM。无登录/数据库先以本地态或最小持久化验证（登录与 DB 列入 M2）。

### 5.1 验收条件（Definition of Done）

| # | 验收项 | 通过标准 |
|---|---|---|
| AC1 | 简历可导入/粘贴并解析 | 上传 PDF/MD/TXT 任一 → 状态 `parsing→parsed`，`analysis` 通过 P01 Schema |
| AC2 | 岗位+方向 → 大纲 | `analyze/directions/outline` 串通，大纲时长 Σ ≤ 档位预算（P04 规则） |
| AC3 | 自我介绍后大纲调整 | P05：陪练需确认、模拟自动；变更落库并通过 Schema |
| AC4 | 主问题 + 作答评价 | P06 取题去重；P07 返回八维、`score` 与加权自洽、`grade` 正确；模拟不返回评价 |
| AC5 | 追问与整场报告 | P08 追问可继续；`finish` 出 P10 报告 |
| AC6 | 契约校验 | 全程 `compose` 输出 100% 过 Schema；失败重试后降级有日志 |
| AC7 | 模式隔离测试 | 陪练/模拟两端行为断言通过 |
| AC8 | 测试与提交 | 单测+契约+冒烟全绿；按规范提交，无敏感文件 |

### 5.2 范围外（M1 不做）

登录（微信/账号）、跨端、真实持久化与录音长期保留、管理员后台的真实 LLM 测试、端到端实时通道、简历多版本/OCR。

### 5.3 M1 验收核对（当前状态）

> 现状盘点（持续更新）：Mock 文本供应商默认跑通全链路；接入真实文本模型可用 `settings` 运行期热切换或 `.env`。
> 验证命令：`pnpm -r run typecheck` 与 `pnpm -r run test`（全仓当前 112 测试全绿：contracts 15 / web 16 / server 81）。

| # | 验收项 | 通过证据 |
|---|---|---|
| AC1 | 简历导入/解析 | `interview-flow.spec`「创建简历并解析 (P01)」+ P01 Schema |
| AC2 | 岗位+方向→大纲 | `interview-flow.spec` AC2；`outline()` 时长超预算返回 409 守卫 |
| AC3 | 自我介绍后大纲调整（模式隔离） | `interview-flow.spec`「大纲调整模式隔离」：模拟未确认自动应用、陪练未确认不应用、确认后应用 |
| AC4 | 主问题+作答评价 | `interview-flow.spec` AC4：P07 返回八维、P08 追问；`normalizeEvaluation` 保证 `score` 与加权自洽 |
| AC5 | 追问与整场报告 | `interview-flow.spec`「追问链」+ AC6 P10；`normalizeSessionReport` 整场归一 |
| AC6 | 契约校验/重试 | `compose.service.spec`：首次合法/重试成功/重试失败抛 ComposeValidationError；`http.provider.spec` 各任务 |
| AC7 | 模式隔离 | `interview-flow.spec`「模式隔离」「模拟模式静默评估」+`evaluation.guard.spec` |
| AC8 | 测试与提交 | 各提交遵循 Conventional Commits；全天 `typecheck`+`test` 全绿 |

### 5.4 M1 范围外确认

login/DB/持久化重启与否、录音长期保留、管理员真实 LLM 测试、端到端实时通道、简历多版本/OCR 属范围外（M2）。已超出 MVP 额外交付：设置页运行期切换文本供应商（[api-spec §5.1](api-spec.md)）、进行中面试一键继续、整场八维归一、「保留录音」偏好持久化、回答转写回顾按环节分组/追问挂主问题、简历结构化确认与方向多选、compose 校验失败降级 502、会话状态复位与可读错误提示、整场方向覆盖按主题去重、评分随作答变化。

## 6. 技术栈（已确认 2026-09-18）

- **Monorepo**：pnpm workspaces；`apps/web` + `apps/server` + `packages/contracts`。
- **后端**：NestJS + `@nestjs/platform-fastify`（结构化 + 快）。
- **契约 / 校验**：`packages/contracts` 用 **zod** 定义端点 DTO 与 P01—P10 输出；`zod-to-json-schema` 生成 `schemas/*.json`；运行时 zod 校验 `compose` 输出，前后端共享同一份契约。
- **数据库**：PostgreSQL + Prisma（迁移/枚举友好）；M1 先做最小持久化。
- **前端**：Vite + React + TypeScript + TanStack Query。
- **测试**：Vitest + Supertest（REST 契约）；后续 Playwright 冒烟。
- **工程**：ESLint + Prettier；Node 20+；脚本走 `pnpm`。

## 7. 推进顺序建议

1. 建立 monorepo 骨架与 `packages/contracts` 契约（zod schema 先行）。
2. 按 M1 验收条件分阶段实现，每阶段本地提交。
3. M1 全绿后进入 M2（登录、持久化、小程序端）。