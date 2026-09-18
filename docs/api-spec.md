# 接口规范（一期 · REST）

> 更新时间：2026-09-18 ｜ 状态：可评审 ｜ 上游：[接口与数据模型](interface-and-data-model.md)、[输出 Schema](output-schemas.md)
>
> 一期采用 **REST / JSON，无 WebSocket**；实时性用 SSE 增量。所有请求带鉴权；错误统一信封；端点覆盖 P01—P10 触发点与管理员模板管理。

## 0. 通用约定

- **Base URL**：生产 `https://api.<域名>/v1`；测试连本机。
- **版本**：路径 `/v1`；破坏性变更升 v2。
- **内容类型**：`application/json; charset=utf-8`；文件上传 `multipart/form-data`。
- **鉴权**：除下列标注 `public` 外，所有请求头携带 `Authorization: Bearer <token>`；`<token>` 为登录成功后返回的会话令牌（双端通用）。
- **状态与错误**：业务成功 2xx；错误统一：

```jsonc
{ "error": { "code": "NOT_FOUND", "message": "资源不存在", "details": { "field": "…" } } }
```

### 通用错误码

| 错误码 | HTTP | 说明 |
|---|---|---|
| `INVALID_REQUEST` | 400 | 参数/JSON Schema 不匹配 |
| `AUTH_UNAUTHORIZED` | 401 | 未登录 / token 失效 |
| `FORBIDDEN` | 403 | 越权（非本用户资源 / 非管理员） |
| `NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT_STATE` | 409 | 当前状态不允许该操作（如面试已结束仍作答） |
| `ACCOUNT_TAKEN` | 409 | 绑定冲突（同手机号/自建账号已被占用） |
| `UPSTREAM_UNAVAILABLE` | 422 | 上游（模型/ASR/TTS）不可用或输出校验失败 |
| `RATE_LIMITED` | 429 | 限流（模型配额/频率） |
| `INTERNAL` | 500 | 内部错误 |

- **翻页**：列表返回 `{ items: [], pageToken?, nextCursor? , total? }`，用游标翻页。

---

## 1. 身份与账号

### 1.1 POST `/auth/register`（公开，MVP）
创建自建账号。用户名在 `self` 登录提供方内唯一；密码只保存 Argon2id 哈希。

- 请求：`{ "username": "string", "password": "string" }`
- 201：`{ "token": "…", "user": { "id", "created": true } }`
- 错误：`INVALID_REQUEST`、`ACCOUNT_TAKEN`

### 1.2 POST `/auth/self`（公开，MVP）
用户名与密码登录，成功后签发 JWT Bearer 会话。

- 请求：`{ "username", "password" }`
- 200：`{ "token", "user": { "id", "created": false } }`
- 错误：`INVALID_REQUEST`、`AUTH_UNAUTHORIZED`

### 1.3 GET `/auth/me`（鉴权，MVP）
当前用户与已绑定身份。

- 200：`{ "user": { "id", "defaultRetention" }, "bindings": [ { "provider", "maskedIdentity" } ] }`
- 错误：`AUTH_UNAUTHORIZED`

### 1.4 POST `/auth/wechat-mini`（公开，M2）
小程序 `wx.login` 的 code 换登录态。服务端调 `code2Session` 换 openid 绑定/登录。

- 请求：`{ "code": "string" }`
- 200：`{ "token": "…", "user": { "id", "created" } }`（**不下发 openid**）
- 错误：`INVALID_REQUEST`、`AUTH_UNAUTHORIZED`（code 无效）

### 1.5 POST `/auth/wechat-web`（公开，M2）
Web 扫码回调 code 换登录态。

- 请求：`{ "code": "string" }`
- 200：同上
- 错误：同上

### 1.6 POST `/auth/sms`（公开，M2）
手机号短信验证码登录。**预留**：需接短信供应商。

- 请求：`{ "phone", "code" }`（`code` = 验证码）
- 200：`{ "token", "user" }`
- 错误：`INVALID_REQUEST`、`AUTH_UNAUTHORIZED`

### 1.7 POST `/auth/bind`（鉴权，M2）
把另一登录方式绑定到当前账号（双端合并）。

- 请求：`{ "provider": "wechat_mini|wechat_web|phone|self", "code?|phone?|username?": "…" }`
- 200：`{ "user" }`
- 错误：`ACCOUNT_TAKEN`、`INVALID_REQUEST`

---

## 2. 简历

### 2.1 POST `/resumes/import`（鉴权，multipart）
上传简历文件 → 创建解析任务。

- 字段：`file`（.pdf/.docx/.md/.txt）、`title?`
- 200（202 语义）：`{ "resume": { "id", "status": "parsing" } }`
- 错误：`INVALID_REQUEST`（格式不支持/超大小上限——上限待需求确认）、`RATE_LIMITED`

### 2.2 POST `/resumes`（鉴权）
粘贴文本创建简历。

- 请求：`{ "title": "…", "text": "…" }`
- 200：`{ "resume": { "id", "status": "parsing", "source": "paste" } }`
- 说明：文本仅本地持久化（§接口草案已决策），不外送第三方。

### 2.3 GET `/resumes/:id`（鉴权，属主）
- 200：`{ "id", "title", "source", "status", "analysis": <P01 结构> }`
- 错误：`NOT_FOUND`、`FORBIDDEN`

### 2.4 PATCH `/resumes/:id`（鉴权，属主）
修正结构化结果字段。

- 请求：局部更新 PATCH 语义（`analysis` 或 `title`）
- 200：`{ "resume" }`
- 错误：`NOT_FOUND`、`FORBIDDEN`、`CONFLICT_STATE`

### 2.5 POST `/resumes/:id/confirmed`（鉴权，属主）
确认简历可用于建面试。

- 请求：`{}`
- 200：`{ "resume": { "status": "confirmed" } }`

---

## 3. 面试流程

> 创作 `Interview` 后处于 `draft`；依序 `analyze → directions → outline → start` 后进入 `active`；按轮作答；`finish` 生成报告进 `finished`。

### 3.1 POST `/interviews`（鉴权）
创建面试（草稿）。

- 请求：`{ "resumeId", "targetRole", "isl"?|"jdText"? }`
- 200：`{ "interview": { "id", "status": "draft" } }`

### 3.2 POST `/interviews/:id/analyze`（鉴权，属主）
触发 P01+P02（简历理解 + 岗位分析）。

- 请求：`{}`
- 200：`{ "role", "seniority", "requiredSkills[], focusAreas[], summary" }`
- 错误：`CONFLICT_STATE`（非 draft）、`UPSTREAM_UNAVAILABLE`

### 3.3 POST `/interviews/:id/directions`（鉴权，属主）
P03 方向推荐，返回多选列表。

- 请求：`{ "selectedDirections"?: ["id", …], "extra"?: "补充诉求" }`
- 200：`{ "recommendedDirections": <P03 结构>, "pendingClarify": [ … ] }`
- 说明：首次不带 `selectedDirections` 返回推荐；带上后返回确认。

### 3.4 POST `/interviews/:id/outline`（鉴权，属主）
P04 生成大纲。

- 200：`{ "outline": <P04 结构> }`
- 错误：`UPSTREAM_UNAVAILABLE`、`CONFLICT_STATE`

### 3.5 POST `/interviews/:id/start`（鉴权，属主）
锁定配置快照（模板版本/风格/量表），进入 `active`。

- 200：`{ "interview": { "status": "active" } }`
- 错误：`CONFLICT_STATE`

### 3.6 POST `/interviews/:id/turns`（鉴权，属主）
P06 开始一道主问题；返回下一问。

- 请求：`{ "phase": "intro|tech|biz|hr" }`
- 200：`{ "turn": { "id", "phase", "seqNo", "question": <P06 文本+考察点> } }`
- 错误：`CONFLICT_STATE`

### 3.7 POST `/interviews/:id/turns/:tid/replay`（鉴权，属主）
重答：为同一道 Turn 新增一条 `after_hint` 作答。

- 请求：`{}`
- 200：`{ "turn": { "attempts": [ … ] } }`（含首次/提示后两条并列）
- 错误：`CONFLICT_STATE`

### 3.8 POST `/interviews/:id/outline/adjust`（鉴权，属主）
P05 自我介绍后大纲调整。`confirm=true` 表示用户已确认改动（陪练模式）。

- 请求：`{ "confirm"?: boolean }`
- 200：`{ "changesApplied": { "outline": <P05 结构> } }`
- 说明：模拟模式自动应用；陪练模式需 `confirm=true` 才应用。

### 3.9 POST `/interviews/:id/finish`（鉴权，属主）
P10 整场报告生成（模拟模式承载统一评价）。

- 200（可先 202 再轮询 `GET…/report`）：`{ "interview": { "status": "finished" } }`
- 说明：长耗时，返回后由前端轮询/SSE 其 `laplport`。

### 3.10 GET `/interviews/:id/report`（鉴权，属主）
- 200：`{ "report": <P10 结构> }`；未生成返回 `{ "status": "pending" }`
- 错误：`CONFLICT_STATE`（未 finish 无法出报告接口）

### 3.11 GET `/interviews`（鉴权）
历史列表 / 跨端最近恢复。

- 参数：`status?`、`pageToken?`
- 200：`{ "items": [{ "id", "kind", "level", "status", "updatedAt", "resumeTitle"? }], "nextCursor"? }`

---

## 4. 作答与语音

### 4.1 POST `/turns/:tid/answer`（鉴权，属主）
提交一次作答：转写文本 + 可选录音引用。

- 请求：`{ "transcript": "…", "audioRef"?: { "ref", "durationMs"? }, "stage": "first|after_hint" }`
- 200（陪练）：`{ "evidence": { "evaluation": <P07> , "next": { "shouldAsk", "question"? } } }`
  - 模拟：仅 `{ "recorded": true }`（不返回评价/提示）
- 说明：`stage` 决定记首次或提示后；由编排层据 kind 做**模式隔离**。
- 错误：`INVALID_REQUEST`、`UPSTREAM_UNAVAILABLE`

### 4.2 POST `/files/audio`（鉴权，multipart）
上传录音，返回引用（供转写与可选持久化）。

- 字段：`file`（mp3/aac/wav/pcm）、`retention?`（request|session|forever，默认 session）
- 200：`{ "ref": "…", "mime", "durationMs"? }`
- 错误：`INVALID_REQUEST`、`RATE_LIMITED`

### 4.3 GET `/files/audio/:ref`
- 200：音频流（TTS 结果或已持久化录音；受鉴权，未保留回收略）。
- 错误：`NOT_FOUND`、`FORBIDDEN`

---

## 5. 语音与模型编排（服务端内部）

> 非对外；由编排层调用。

- `asr(audioRef/fileUri) → { text, segments, confidence, lang }`
- `tts(text, voice) → { audioRef/stream, durationMs }`
- `compose(interviewId, taskCode, stageInput) → <P01–P10 对应结构化 JSON>`
  - `compose` 入参 = 上述上下文 + 锁定模板/风格/量表 + 本场输入；出参经 [output-schemas](output-schemas.md) 校验。
- 供应商路由见 [系统架构 §5](system-architecture.md)：语音默认 GLM、可切阿里；文本 LLM 预设+自定义。

---

## 6. 管理员 · 提示词模板（M2，鉴权 + `role=admin`）

### 6.1 CRUD `/admin/templates`
- `GET/POST /admin/templates`：列表/新建模板（`taskCode` P01—P10 唯一，冲突返回 `CONFLICT_STATE`/400）。
- `GET/PATCH /admin/templates/:id`：读取/编辑**草稿**。
- 请求体核心：`{ "taskCode", "name", "description", "basePrompt", "variables": ["userId","jdText",…] }`

### 6.2 版本生命周期 `/admin/templates/:id/versions`
- `POST {action: "test"}`：运行示例测试（非空草稿 + 顺序检查），返回 `testResult`。
- `POST {action: "publish"}`：草稿→发布为新版本；**同期已发布旧版本冻结**。
- `POST {action: "rollback"}`：回滚创建新版本并 `basedOnId` 标注来源。
- `GET`：版本列表（含 `status`、`createdBy`、`createdAt`）。

---

## 7. 实施备注

- **令牌**：JWT（含 `userId`、`role`、过期）；管理员标 `role=admin`。
- **SSE**：`POST /turns/:tid/answer`、`POST /interviews/:id/finish` 等长任务可用 SSE 增量返回（转写逐步、报告进度），避免长轮询。
- **幂等**：创建类端点支持 `Idempotency-Key` 头幂等重试。
- **审计**：管理员模板操作（发布/回滚）记录 `createdBy`、时间与前后版本，可追溯。
- **字段粒度/错误码多条**：评审通过后固化为 OpenAPI 契约文档。
