# 外部对接清单与操作手册

更新时间：2026-09-20

本文面向开发、部署和联调人员，整理 ai_interviewer 上线前需要申请、配置和验收的外部系统。当前仓库是 Web 单端 M1：默认 Mock 文本/语音，不配置外部账号也可以运行；表格中的 M2 项目是产品化上线所需，不代表已经完成代码接入。

## 第一部分：外部对接表格清单

### 1. 总体清单

| 优先级 | 外部系统 | 对接用途 | 推荐方案 | 当前状态 | 必需凭据/配置 | 上线前验收 |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | 文本大模型 | P01—P10：简历理解、出题、评价、复盘 | 智谱 GLM 主选；Qwen 备选；DeepSeek 成本/文本备选 | M1 已支持 OpenAI 兼容文本 provider；默认 Mock | Base URL、模型名、API Key、超时和限流 | 10 类任务均能返回合法 JSON；Schema 校验、重试和降级生效 |
| P0 | PostgreSQL | 用户、简历、面试、turn、attempt、评价、报告、提示词版本 | PostgreSQL + Prisma | M1 未接入；当前为内存/JSON 文件 | DATABASE_URL、迁移权限、备份策略 | 重启不丢数据；跨用户隔离；迁移和恢复演练通过 |
| P0 | 微信小程序开放能力 | 小程序登录、账号绑定、录音上传、跨端数据 | 微信公众平台小程序 | 小程序尚未实现 | AppID、AppSecret、服务器域名、业务域名、备案 | `wx.login` 登录成功；openid 不下发；录音可上传并恢复面试 |
| P0 | 微信开放平台 Web OAuth | Web 扫码登录，与小程序账号绑定 | 微信开放平台网站应用 | Web 登录尚未实现 | 网站应用 AppID/AppSecret、回调 URL、HTTPS 域名 | 扫码登录、回调、账号绑定和失败重试通过 |
| P0 | ASR 语音识别 | 用户回答转写 | 智谱 GLM ASR 主选；阿里 Paraformer 备选 | M1 为 MockVoiceGateway | 供应商 API Key、区域/模型、音频格式和时长限制 | 中文语音转写、置信度、超时、重试和错误提示正确 |
| P0 | TTS 语音合成 | 面试官问题播报 | 智谱 GLM TTS 主选；阿里 CosyVoice 备选 | M1 为 MockVoiceGateway | 供应商 API Key、音色、采样率和输出格式 | Web 与小程序均可播放；音频引用生命周期正确 |
| P0 | 对象存储 | 录音、TTS 音频和可能的简历文件 | S3 兼容存储；国内部署可选阿里 OSS/腾讯 COS | M1 音频仅内存 | Endpoint、Bucket、Region、Access Key、Secret Key | 私有读、短期签名 URL、删除和生命周期规则通过 |
| P1 | Redis | 限流、验证码、短期登录态、异步任务和分布式锁 | Redis 7+ | 未接入 | REDIS_URL、TLS、密码、淘汰策略 | 限流跨实例生效；验证码/锁不会永久残留 |
| P1 | PDF/DOCX 解析 | 简历文件导入 | 服务端解析库；扫描 PDF 再接 OCR | 当前仅粘贴文本/MVP 简单文本路径 | 文件大小上限、解析库或 OCR API | PDF/DOCX/MD/TXT 成功、损坏文件可恢复、原文不外泄 |
| P1 | 短信服务 | 自建账号的短信验证码兜底 | 国内短信供应商 | 仅接口设计，未接入 | Access Key、签名、模板 ID、发送频控 | 验证码发送、校验、过期、重试和防刷通过 |
| P1 | 域名 / HTTPS / 备案 | Web、API、微信合法域名和 OAuth 回调 | HTTPS 证书 + 已备案域名 | 本地开发使用 127.0.0.1 | 域名、DNS、证书、ICP 备案、服务器域名白名单 | Web、API、微信回调和音频下载均为 HTTPS |
| P1 | 部署运行环境 | 托管 Web、API、数据库、任务和密钥 | 云服务器或容器平台 | 当前为本地启动 | CPU/内存、容器、日志、备份、发布权限 | 健康检查、滚动发布、回滚、备份恢复通过 |
| P1 | 监控与告警 | 发现模型失败、接口错误、延迟和费用异常 | 云监控 + 日志平台；可选 Sentry | 未接入 | DSN、日志桶、告警联系人、脱敏规则 | 不记录密钥/简历全文；错误可定位并触发告警 |
| P2 | 端到端实时语音 | 降低 Web 端延迟、支持打断 | GLM-Realtime 或 Qwen-Omni-Realtime | 不属于级联基线 | WebSocket/WebRTC、模型权限、并发和费用配置 | 独立灰度，不影响级联链路和结构化输出 |

### 2. 模型能力矩阵

| 供应商 | 文本 LLM | ASR | TTS | 端到端实时 | 建议角色 |
| --- | --- | --- | --- | --- | --- |
| 智谱 GLM | 支持 | 支持 | 支持 | 支持 | 默认文本、默认 ASR/TTS，优先完成首个真实链路 |
| 阿里百炼 / Qwen | 支持 | Paraformer | CosyVoice | Qwen Omni | 语音备选、文本备选；适合做供应商切换验证 |
| DeepSeek | 支持文本/视觉 | 不提供 | 不提供 | 不作为语音方案 | 低成本文本备选，不要配置为 ASR/TTS |

### 3. 账号与权限清单

| 账号 | 需要创建的资源 | 应由谁持有 | 最小权限 | 不能做的事 |
| --- | --- | --- | --- | --- |
| 模型供应商 | 文本、ASR、TTS API 项目 | 公司/项目管理员 | 仅调用对应模型和查询用量 | 不把主账号密钥放进前端或 Git |
| PostgreSQL | 生产库、迁移用户、应用用户 | 运维/后端负责人 | 应用用户仅读写业务表；迁移单独账号 | 不让应用连接使用超级用户 |
| 对象存储 | 私有 Bucket、应用 Access Key | 运维负责人 | 指定 Bucket 的读写/删除 | 不设置公开读写 |
| 微信小程序 | 小程序 AppID、AppSecret、合法域名 | 产品/管理员 | 开发、体验版、发布权限分离 | 不将 AppSecret 下发客户端 |
| 微信开放平台 | 网站应用和回调地址 | 产品/管理员 | OAuth 与账号绑定所需权限 | 不在前端直接换取 openid/session_key |
| 短信 | 发送签名、模板、频控 | 运维/产品负责人 | 仅发送指定模板 | 不把验证码写入日志 |

## 第二部分：操作手册

### 0. 对接原则与顺序

按下面顺序执行，先完成基础设施，再接用户端能力：

1. 创建供应商项目和密钥，建立开发、测试、生产三套配置。
2. 先接文本 LLM，保持语音为 Mock，验证 P01—P10 全链路。
3. 接 PostgreSQL/Prisma，完成用户隔离和重启恢复。
4. 接对象存储，再接真实 ASR/TTS，验证录音删除和保留策略。
5. 接微信小程序登录与 Web OAuth，最后打开强制登录。
6. 接短信、Redis、监控和部署发布能力。
7. 端到端实时语音只做灰度增强，不替换级联基线。

### 1. 本地 M1：只接真实文本模型

当前仓库无需外部服务即可启动。需要接真实文本模型时：

```bash
cp .env.example .env
```

编辑 `.env`：

```dotenv
AI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
AI_MODEL=glm-4-flash
AI_API_KEY=仅写入本机，不要提交
GLM_MODEL=glm-4-flash
DATA_FILE=.data/store.json
```

启动并检查：

```bash
pnpm install
pnpm run lint
pnpm run smoke
pnpm --filter @ai-interviewer/server start
```

另开终端执行：

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/settings/model
```

也可以在 Web「设置 → 模型配置」中使用 GLM、DeepSeek、Qwen 预设或自定义 OpenAI 兼容 API。当前 `AI_API_KEY`、自定义 API Key 只在服务端内存/环境中使用；M2 上线前必须改为加密密钥管理，并禁止接口回显密钥。

### 2. 文本 LLM 对接操作

#### 2.1 智谱 GLM（默认主选）

1. 创建智谱开放平台账号和 API Key。
2. 确认账户有目标文本模型调用权限和余额/额度。
3. 将 Base URL、模型名和 Key 写入测试环境密钥管理，不写入前端。
4. 通过 `/settings/model/test` 测试连通性。
5. 依次验证 P01、P02、P03、P04、P06、P07、P08、P09、P10 的结构化输出。
6. 检查异常模型输出时，ComposeService 是否执行校验、重试并返回统一错误。

#### 2.2 Qwen（文本/语音备选）

1. 创建阿里云百炼项目和 API Key。
2. 使用 OpenAI 兼容地址配置文本模型。
3. 用 `/settings/model/test` 验证连通性，再跑完整 `smoke:e2e`。
4. 单独登记模型上下文长度、结构化输出、限流和费用差异。

#### 2.3 DeepSeek（文本成本备选）

1. 创建 DeepSeek API Key。
2. 仅配置为文本 LLM provider。
3. 验证 P01—P10 输出 Schema 和长上下文截断策略。
4. 不要把 DeepSeek 配置到 ASR/TTS，因为它不提供本项目所需语音接口。

### 3. PostgreSQL + Prisma 对接操作

1. 创建独立数据库和应用用户；迁移用户与运行用户分离。
2. 为开发、测试、生产创建不同数据库，禁止本地连接生产库。
3. 配置：

```dotenv
DATABASE_URL=postgresql://app_user:password@db.example.com:5432/ai_interviewer?sslmode=require
```

4. 建立 Prisma schema 和第一版 migration，至少覆盖 `User`、`AccountBinding`、`Resume`、`Interview`、`Turn`、`Attempt`、`Evaluation`、`SessionReport`、`PromptTemplate`、`PromptVersion`、`AudioAsset`。
5. 应用启动时只执行已审核 migration；生产环境不自动 `db push`。
6. 验收：创建用户 A/B，确认 A 无法读取、修改或删除 B 的简历、面试、录音和报告；重启服务后数据仍存在。
7. 配置备份、恢复和迁移回滚演练，再将 `DATA_FILE` 作为生产方案下线。

### 4. ASR/TTS 真实语音对接操作

项目采用级联基线：

```text
用户录音 → ASR → 转写文本 → P07/P08/P09/P10 文本模型 → TTS → 面试官音频
```

对接步骤：

1. 先实现 `VoiceGateway` 的真实 provider，保留 `MockVoiceGateway` 作为测试实现。
2. ASR 返回统一结构：`text`、`segments`、`confidence`、`lang`。
3. TTS 返回统一结构：`audioRef/stream`、`durationMs`、`mime`。
4. 录音先上传对象存储，服务端只保存不可猜测的引用和元数据。
5. 对音频设置大小、时长、格式、超时、重试和费用上限。
6. 结束面试时按 `keepAudio` 删除或保留；删除面试必须同时删除对象存储文件。
7. 分别验证：空音频、损坏音频、ASR 无结果、TTS 超时、重复提交、供应商限流、网络重试和播放失败。

推荐首个真实组合：GLM ASR + GLM 文本模型 + GLM TTS。完成后再接阿里 ASR/TTS 做切换和故障回退测试。

### 5. 微信小程序对接操作

#### 5.1 小程序账号

1. 注册微信公众平台小程序，确认主体类型、类目和备案要求。
2. 获取 AppID/AppSecret；AppSecret 只放服务端密钥管理。
3. 配置 request 合法域名、uploadFile 合法域名、downloadFile 合法域名和业务域名，全部使用 HTTPS。
4. 小程序端调用 `wx.login` 获取临时 code，发送到服务端 `/auth/wechat-mini`。
5. 服务端调用微信 `code2Session`，保存 openid/unionid 的哈希或加密值，返回本项目 JWT；不把 session_key/openid 返回前端。
6. 验收登录失败、code 过期、重复登录、账号绑定、注销和跨端恢复。

#### 5.2 Web 扫码 OAuth

1. 在微信开放平台创建网站应用。
2. 配置 HTTPS OAuth 回调 URL，例如 `https://api.example.com/auth/wechat-web/callback`。
3. Web 端只拿授权 code；服务端完成换 token、查询身份和账号绑定。
4. 回调必须校验 state、防重放、过期时间和错误回调。
5. 将 Web 身份与小程序身份绑定到同一 `User`，处理“已存在账号”和“合并冲突”。

### 6. 对象存储对接操作

1. 创建私有 Bucket，关闭公开读写。
2. 创建仅限指定 Bucket 的应用 Access Key；生产 Key 与开发 Key 分开。
3. 配置 M2 建议变量：

```dotenv
OBJECT_STORAGE_ENDPOINT=https://storage.example.com
OBJECT_STORAGE_BUCKET=ai-interviewer-prod
OBJECT_STORAGE_REGION=cn-hangzhou
OBJECT_STORAGE_ACCESS_KEY=由密钥管理注入
OBJECT_STORAGE_SECRET_KEY=由密钥管理注入
```

4. 音频下载使用短期签名 URL 或服务端代理，不把永久对象地址下发。
5. 配置生命周期：未附着对象快速清理；默认录音面试结束删除；用户明确保留的录音按保存期限清理。
6. 验收权限、跨用户访问、删除、过期、备份和恢复。

### 7. Redis、短信和监控

#### Redis

用于验证码、限流、短期 OAuth state、分布式锁和异步任务状态；不作为简历/报告的唯一持久化存储。开启 TLS，设置 TTL，避免把敏感原文放入 Redis。

#### 短信

1. 申请短信签名和验证码模板。
2. 配置单手机号、单 IP、单设备和全局发送频率。
3. 验证码只保存哈希、过期时间和尝试次数。
4. 日志只记录 request id 和结果，不记录手机号全文、验证码和供应商响应中的密钥。

#### 监控

至少监控：HTTP 5xx/4xx、模型延迟与失败率、ASR/TTS 失败率、Schema 重试次数、音频存储量、数据库连接池、登录失败率和供应商费用。所有日志先脱敏，再发送到日志平台。

### 8. 上线前总验收

- [ ] 所有生产密钥已进入密钥管理，Git 和前端构建产物中无密钥。
- [ ] 文本 LLM 主备切换通过，DeepSeek 未被误用为语音 provider。
- [ ] ASR/TTS 真实链路与 Mock 链路均有自动化测试。
- [ ] PostgreSQL migration、备份、恢复和跨用户隔离通过。
- [ ] 微信小程序登录、Web OAuth、账号绑定和 JWT 过期处理通过。
- [ ] 对象存储为私有读，音频删除和保留策略通过。
- [ ] CORS、HTTPS、微信合法域名、回调 state 和限流已配置。
- [ ] `pnpm run lint`、`pnpm run smoke`、HTTP 冒烟、浏览器回归和部署健康检查全部通过。
- [ ] 供应商余额、用量、告警联系人和故障切换值班流程已登记。

### 9. 常见问题排查

| 现象 | 优先检查 |
| --- | --- |
| 模型连接失败 | Base URL 是否含正确路径、模型权限、API Key 是否过期、服务端是否能访问外网 |
| 模型返回 502 | 原始 JSON 是否符合任务 Schema、上下文是否过长、重试日志中的 task code |
| 语音无转写 | 音频 MIME/编码/时长、对象存储签名 URL、ASR 供应商权限和区域 |
| 小程序登录失败 | AppID/AppSecret、code2Session、服务器域名白名单、HTTPS 证书和备案 |
| Web OAuth 回调失败 | redirect URI 是否完全一致、state 是否过期、开放平台网站应用配置 |
| 重启后数据丢失 | 是否仍使用 `DATA_FILE`、DATABASE_URL 是否生效、migration 是否执行 |
| 音频无法播放 | Content-Type、签名 URL 过期、跨域/合法下载域名、对象是否被生命周期删除 |

