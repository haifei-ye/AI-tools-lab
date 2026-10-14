# Agent Reach 源码研究

本目录用于研究 [Agent Reach](https://github.com/Panniantong/Agent-Reach) 在 AI Agent 生态中的定位：它如何为 Agent 选择、配置、检查并路由外部信息渠道。

## 项目定位

Agent Reach 不是完整的 Agent Runtime，也不是统一的权限沙箱。当前源码更接近一个**外部信息能力接入层**：

- Skill 文档描述任务触发、平台选择、安全规则和上游命令；
- Channel 抽象负责能力状态检查与 backend 路由；
- CLI 负责安装、配置、doctor 和少量集成；
- 真正的内容读取通常由宿主 Agent 直接调用 Jina Reader、平台 CLI、OpenCLI 或 MCP Server 等上游工具完成。

因此，Agent Reach 解决的是“Agent 如何知道该用哪种外部能力以及该能力是否可用”，而不是替代 Agent 的规划循环、工具执行器或 Runtime 隔离。

## 与 REA、OpenHands 的关系

| 项目 | 在本学习仓库中的作用 | 与 Agent Reach 的关系 |
|---|---|---|
| REA | 静态代码关系分析工具 | 可辅助分析 JavaScript/TypeScript 项目；Agent Reach 当前核心为 Python 与 Markdown，本研究主要采用人工源码阅读。REA 不是 Agent Reach 的运行依赖。 |
| OpenHands | Agent 循环、Tool、事件和 Runtime/Sandbox 研究对象 | 可作为 Agent Reach 能力的宿主执行层。推荐把获准的 Agent Reach 能力包装为窄 `ToolDefinition`，通过 Action/Observation、确认策略和隔离 Runtime 执行。 |
| Agent Reach | 外部信息渠道的 Skill、状态检测与 backend 路由层 | 为宿主 Agent 提供“选择什么能力、怎样调用”的知识，但不自动获得 OpenHands 的隔离和确认能力。 |

三者可以形成互补链路：

```text
REA：帮助理解代码结构
OpenHands：负责 Agent 决策、受控执行和结果回流
Agent Reach：提供外部信息能力的发现、路由与调用说明
```

## 目录结构

```text
agent-reach-study/
├── agent-reach/       # 官方源码 Git submodule
├── notes/             # 分阶段研究笔记
├── .gitignore         # 本地依赖、缓存和临时输出排除规则
└── README.md
```

## 六阶段研究路线

| 阶段 | 笔记 | 研究内容 | 状态 |
|---|---|---|---|
| 1 | [01-overview.md](notes/01-overview.md) | 项目用途、生态定位、技术栈、仓库结构、核心模块、License 和学习路线 | 已完成 |
| 2 | [02-architecture.md](notes/02-architecture.md) | 用户入口、Capability/Provider 边界、状态检测、安装与路由数据流 | 已完成 |
| 3 | [03-skill-tool-flow.md](notes/03-skill-tool-flow.md) | Skill 组织、Channel 状态、backend 选择、外部工具与 MCP 调用流程 | 已完成 |
| 4 | [04-security-model.md](notes/04-security-model.md) | Skill 声明与实际命令、凭据边界、外部服务信任，以及与 OpenHands Runtime Sandbox 的对比 | 已完成 |
| 5 | [05-first-experiment-plan.md](notes/05-first-experiment-plan.md) | 无账号、无 Cookie、无写操作的最小能力接入实验设计，以及未来接入 OpenHands 的方案 | 已完成 |
| 6 | [06-first-experiment-result.md](notes/06-first-experiment-result.md) | 对固定公开页面执行一次 Jina Reader 最小实验，记录 Evidence、失败事件和未验证项 | 已完成 |

## 当前实验状态

前五阶段只做静态源码阅读与实验设计。第六阶段只对 `https://example.com/` 发起了一次无账号、无 Cookie、无 Token 的 Jina Reader 只读请求：

- 结果：限定范围内 `PASS`；
- HTTP 状态：`200`；
- curl 退出码：`0`；
- 网络请求：1 次；自动重试：0 次；backend fallback：0 次；
- 未使用 GitHub、MCP、登录态或外部写操作；
- Jina 返回缓存快照，因此源页面实时新鲜度仍未验证；
- 未安装 Agent Reach 或上游工具，未运行完整环境，官方源码保持 clean。

该实验验证了“Skill/reference 中的路由说明 → web/Jina Reader → Evidence”，没有验证正式宿主对 Skill 的自动发现，也不能证明其他 Channel 可用。

## Submodule

本次研究对应的官方源码快照：

- 远程：`https://github.com/Panniantong/Agent-Reach.git`
- 分支：`main`
- 提交：`94f06c1969dfc1834001269d79d3ad0972d9dee6`
- 源码声明版本：`1.5.0`

克隆主仓库后可用以下命令取得子模块：

```bash
git submodule update --init --recursive
```

## 研究原则

- 不修改官方源码；
- 不提交虚拟环境、`node_modules`、缓存、raw output 或临时文件；
- 区分官方声明、源码可证实行为、架构推测和未验证运行结果；
- 后续动态实验单独设计，需要安装、凭据、Cookie 或平台账号时先征得授权。
