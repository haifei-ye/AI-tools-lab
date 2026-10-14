# OpenHands 源码研究

本目录用于系统研究 OpenHands 的软件 Agent 架构，重点关注 Agent 如何理解任务、调用工具、维护状态、操作 Workspace、在 Runtime 中执行命令，以及如何通过 MCP 扩展外部能力。

研究采用“REA 静态分析 + 人工源码阅读”的方式：

- REA 用于其支持的 JavaScript/TypeScript 代码关系分析；
- Python 核心调用链由人工阅读源码补充和校验；
- 官方源码通过 Git submodule 管理并保持 clean；
- 不在本目录提交依赖、缓存、原始分析输出或临时文件；
- 当前阶段只做静态研究，不启动完整 OpenHands 环境。

## 目录结构

```text
openhands-study/
├── openhands/             # OpenHands Agent Canvas 官方源码 submodule
├── software-agent-sdk/    # OpenHands SDK、Agent Server 与 Tool 官方源码 submodule
├── notes/                 # 分阶段研究笔记
├── rea-analysis/          # 本地 REA 分析产物，不提交
└── README.md
```

克隆主仓库后，可用以下方式取得 submodule 源码：

```bash
git submodule update --init --recursive
```

## 项目介绍

OpenHands 不是只生成文字回答的普通聊天机器人。它把以下部分组合成一个可执行的软件工程 Agent 系统：

```text
用户请求
→ Agent / LLM 决策
→ ActionEvent
→ Tool
→ Workspace / Runtime / 外部服务
→ ObservationEvent
→ 下一轮决策与验证
```

核心能力包括：

- 理解代码仓库和任务上下文；
- 使用文件、Shell、浏览器及其他结构化工具；
- 修改真实 Workspace 并运行构建、检查和测试；
- 通过事件历史和 Conversation State 保持多轮执行状态；
- 使用 Runtime、Docker 或其他后端承载执行环境；
- 通过 MCP Server 接入外部数据和业务能力；
- 根据真实 Tool Observation 继续修正，形成执行与验证闭环。

## 研究路线

研究按由外到内、再由核心机制到扩展能力的顺序推进：

1. 先建立项目用途、技术栈、仓库结构和整体架构地图；
2. 追踪用户请求进入系统后的 Agent 执行循环；
3. 分析 Tool 注册、发现、调用和 Observation 回流；
4. 理解 Conversation State、EventLog、短期上下文和持久状态；
5. 区分 Workspace 与 Runtime，追踪文件修改到测试验证的完整链路；
6. 分析 MCP Server、Client、ToolDefinition 和原生 Tool 的统一关系。

推荐阅读顺序：

| 顺序 | 笔记 | 主题 |
|---:|---|---|
| 1 | [01-overview.md](notes/01-overview.md) | 项目用途、技术栈、License 与核心能力 |
| 2 | [02-architecture.md](notes/02-architecture.md) | Agent、Planner、Memory、Tool 与 Runtime 总体架构 |
| 3 | [03-code-structure.md](notes/03-code-structure.md) | 仓库结构和核心模块定位 |
| 4 | [04-first-REA-analysis.md](notes/04-first-REA-analysis.md) | 第一次 REA 静态分析与人工补充 |
| 5 | [05-agent-loop.md](notes/05-agent-loop.md) | 用户请求、LLM、Action、Observation 与循环控制 |
| 6 | [06-tool-system.md](notes/06-tool-system.md) | Tool 注册、执行、结果反馈及 MCP Tool 模型比较 |
| 7 | [07-memory-system.md](notes/07-memory-system.md) | Memory、Conversation State、EventLog 与上下文管理 |
| 8 | [08-workspace-runtime.md](notes/08-workspace-runtime.md) | Workspace、Runtime、Shell、隔离和测试验证闭环 |
| 9 | [09-mcp-integration.md](notes/09-mcp-integration.md) | MCP 原生支持、Tool 适配、调用流程与应用方向 |

## 已完成阶段

### 第一阶段：项目与架构总览

已完成项目用途、技术栈、License、仓库结构、核心模块和初次 REA 静态分析，形成后续研究所需的源码地图。

对应笔记：`01`—`04`。

### 第二阶段：Agent 执行循环

已追踪用户消息进入 Conversation 后，经 LLM planning、Action、Tool、Observation、reflection/下一轮决策直到完成的关键调用链。

对应笔记：`05-agent-loop.md`。

### 第三阶段：Tool 系统

已分析 Tool 注册和发现、ActionEvent 到 ObservationEvent 的执行路径，以及 Shell、File、Runtime 等核心工具如何影响下一轮 Agent 决策。

对应笔记：`06-tool-system.md`。

### 第四阶段：Memory 与状态管理

已分析 EventLog、Conversation State、View、Condenser、持久化状态及其与普通 Chat History 的区别。

对应笔记：`07-memory-system.md`。

### 第五阶段：Workspace 与 Runtime

已区分工作目录抽象和执行环境，分析文件读写、Shell 接入、Docker/Sandbox 隔离，以及一次代码修改到测试验证的完整工程链路。

对应笔记：`08-workspace-runtime.md`。

### 第六阶段：MCP 集成

已确认 OpenHands 原生支持作为 MCP Client 消费外部 MCP Server，将运行时发现的 MCP Tool 适配为统一 `ToolDefinition`，并分析 Discovery、Tool Call、Result 和 Observation 全流程。

对应笔记：`09-mcp-integration.md`。

## 研究边界

- 笔记基于所记录的本地 submodule 源码快照，不自动代表未来版本；
- REA Evidence 证明的是静态代码关系，不证明运行时路径一定执行；
- Python 部分没有使用 REA 自动分析，均由人工源码阅读补充；
- 尚未启动完整 OpenHands 环境，因此动态行为会在后续独立实验中验证；
- 对 Docker、OAuth、MCP、云端 Runtime 等能力的安全结论不能替代正式部署审计。
