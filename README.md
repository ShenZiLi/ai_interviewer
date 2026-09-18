# ai_interviewer

帮助求职者提高面试能力的语音对话 Agent。一期聚焦 Java 后端，支持电脑 Web 和微信小程序。

目前处于「需求与设计已完成、MVP 实现推进中」阶段：Web 单端最小闭环已可跑通（无登录/数据库，Mock 供应商默认）。

- [需求与决策记录](docs/requirements.md)
- [系统架构与技术选型](docs/system-architecture.md)
- [接口规范](docs/api-spec.md) ｜ [输出 Schema 与校验](docs/output-schemas.md)
- [开发规范与验收标准](docs/dev-standard.md)
- [项目协作规范](AGENTS.md)

## 运行 Web MVP

前置：Node ≥20、`pnpm`（如未有：`npm i -g pnpm` 或 `corepack enable`）。

```powershell
# 首次安装依赖
pnpm install
# 后端（NestJS + Fastify，端口 3000）
pnpm --filter @ai-interviewer/server start
# 前端（Vite + React，端口 5173）
pnpm --filter @ai-interviewer/web dev --host
```

打开 http://localhost:5173 体验：工作台 → 我的简历（导入/粘贴 → 解析）→ 准备面试（选方向/模式/时长 → 生成流程并预览题目 → 开考）→ 面试室（录音或文本作答 → 评分/误区澄清/追问/重答/同环节再问一题 →）→ 复盘报告（八维与逐题自洽的整场归一、回答转写回顾、报告「vs 上一场」逐维趋势、本场最佳/最需改进作答高亮、工作台「成绩走势」与按目标岗位筛选）；侧栏「提示词管理」可维护 P01—P10 模板（草稿/示例测试/发布/回滚/删除，开场快照锁定版本）。工作台可对「进行中」的面试一键继续，中途离开不回丢失进度。

> 本地跨域：后端已启用 CORS（反射请求源），前端 5173 直连 3000 无需代理。

不配置模型密钥时，服务端用 Mock 样本跑通全流程。接入真实文本模型（GLM/DeepSeek/Qwen 均 OpenAI 兼容）有二路：① 复制 [.env.example](.env.example) 为 `.env` 填写 `AI_BASE_URL/AI_MODEL/AI_API_KEY` 后重启后端；② 或启动后在 Web「设置 → 模型配置」里选厂商预设/填自定义 API，**运行期热切换、免重启**。设置 `DATA_FILE`（见 `.env.example`）可启用 M1 最小持久化，简历/面试/转写/评价重启不丢（默认纯内存）。

测试与校验：

```powershell
pnpm -r run typecheck
pnpm -r run test
pnpm --filter @ai-interviewer/web run build   # 前端生产构建
pnpm smoke:e2e                                 # 端到端回归冒烟（需先启动后端）
```

## 第一版 UI 原型

直接用浏览器打开 `prototype/index.html`，或在项目根目录运行：

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory prototype
```

然后访问 http://127.0.0.1:8765 。顶部可切换 Web 与小程序尺寸预览。

推荐体验路线：开始新的面试 → 确认示例简历 → 选择考察方向与模式 → 查看流程 → 自我介绍 → 动态大纲调整 → 技术问答与反馈。

原型仅使用虚构数据，无真实语音、简历解析、模型请求、登录或持久化。报告与评分固定，不代表对输入的实际分析。参见 [原型范围](docs/prototype-v1.md)。

v0.2 增加用户风格选项和顶部“管理员演示”入口，展示 P01—P10 提示词的草稿、测试、发布与回滚。参见 [风格与提示词管理](docs/prompt-management.md)。真实管理员账号、服务端权限和 LLM 测试尚未实现。
