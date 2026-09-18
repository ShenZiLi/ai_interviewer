# ai_interviewer

帮助求职者提高面试能力的语音对话 Agent。一期聚焦 Java 后端，支持电脑 Web 和微信小程序。

目前处于需求分析与设计阶段，尚未开始产品代码开发。

- [需求与决策记录](docs/requirements.md)
- [项目协作规范](AGENTS.md)

## 第一版 UI 原型

直接用浏览器打开 `prototype/index.html`，或在项目根目录运行：

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory prototype
```

然后访问 http://127.0.0.1:8765 。顶部可切换 Web 与小程序尺寸预览。

推荐体验路线：开始新的面试 → 确认示例简历 → 选择考察方向与模式 → 查看流程 → 自我介绍 → 动态大纲调整 → 技术问答与反馈。

原型仅使用虚构数据，无真实语音、简历解析、模型请求、登录或持久化。报告与评分固定，不代表对输入的实际分析。参见 [原型范围](docs/prototype-v1.md)。
