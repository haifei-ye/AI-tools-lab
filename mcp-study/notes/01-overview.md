# MCP 项目概览

> - 研究日期：2026-10-14
> - 官方仓库：`modelcontextprotocol/modelcontextprotocol`
> - submodule 提交：`5ea996028df322ce97d1c906731cf8c05a6e268e`
> - 研究规范版本：`2026-07-28`
> - 方法：官方规范、schema 与本地既有项目源码的静态阅读
> - 未安装依赖、未启动 MCP Server、未连接账号、未修改官方源码

## 0. 前提修正与研究边界

### 0.1 官方仓库不是 Server 实现

用户给出的 `https://github.com/modelcontextprotocol/modelcontextprotocol` 仍是官方推荐的**规范、协议 schema 和文档仓库**。仓库自身的 [`README.md`](../servers/modelcontextprotocol/README.md) 明确列出：

- MCP specification；
- MCP protocol schema；
- 官方文档。

官方组织还分别维护 `servers`、TypeScript SDK、Python SDK 等仓库，但它们不是本阶段指定的研究对象。因此，本次把规范仓库放在 `servers/modelcontextprotocol/` 只是沿用学习目录约定，不表示它本身是可运行 Server。

### 0.2 MCP 核心架构不能漏掉 Host

“Client、Server、Tool、Resource、Prompt”不足以完整描述 MCP。当前 [`2026-07-28 architecture`](../servers/modelcontextprotocol/docs/specification/2026-07-28/architecture/index.mdx) 明确采用：

```text
Host → Client ↔ Server
```

Host 才是连接权限、用户授权、LLM 集成、上下文汇总和安全策略的协调者。Client 是 Host 内与一个特定 Server 通信的协议连接器。把 Client 当成完整 Agent，会遗漏最重要的信任与控制边界。

### 0.3 Agent 不一定必须使用 MCP

MCP 对需要连接多个外部系统、复用第三方能力或动态发现工具的 Agent 很有价值，但不是所有 Agent 的必需组件。一个只调用少量内部函数、没有跨应用复用需求的 Agent，直接使用本地 Tool/Function Calling 可能更简单。

### 0.4 版本差异必须显式记录

本笔记以当前官方仓库中的 `2026-07-28` 正式规范为基准。该版本采用无会话的 stateless core：每个请求携带协议版本和 Client capabilities，`server/discover` 是可选的预先发现调用。旧资料中的 `initialize / initialized` handshake 和 Session ID 属于较早协议时代，不能直接套用到当前规范。

## 1. MCP 是什么

### 1.1 源码确认事实

MCP（Model Context Protocol）是一个开放协议，用统一方式把 LLM 应用连接到外部数据源、工具和工作流。当前规范的关键特征包括：

- Client–Host–Server 架构；
- 以 JSON-RPC 2.0 表达 request、response 和 notification；
- 当前 `2026-07-28` core 是 stateless，每个请求自包含；
- Client 和 Server 通过 capabilities 声明支持的功能；
- Server 主要向 Client 暴露 Tool、Resource 和 Prompt；
- 标准 transport 包括 stdio 和 Streamable HTTP；
- HTTP 场景另有 Authorization 框架。

官方定义见 [`specification/2026-07-28/index.mdx`](../servers/modelcontextprotocol/docs/specification/2026-07-28/index.mdx)，协议消息的 TypeScript source of truth 位于 [`schema/2026-07-28/schema.ts`](../servers/modelcontextprotocol/schema/2026-07-28/schema.ts)。

### 1.2 MCP 不是什么

MCP 本身不提供：

- LLM 或 Agent 规划循环；
- Tool 的业务实现；
- 对 Server 的可信背书；
- 自动权限隔离或 Sandbox；
- 用户确认 UI；
- 对 Tool 结果真实性的证明；
- 跨业务统一的长期 Memory。

规范明确指出 MCP 会形成任意数据访问和代码执行路径，同时协议层不能强制落实全部安全原则。Host 和实现者仍需负责授权、访问控制、隔离与隐私保护。

### 1.3 最小心智模型

```text
用户
  → Host（Agent/IDE/聊天应用）
      → MCP Client A ↔ Server A（Tool/Resource/Prompt）
      → MCP Client B ↔ Server B（Tool/Resource/Prompt）
      → MCP Client C ↔ Server C（Tool/Resource/Prompt）
```

当前规范中，一个 Host 可以创建多个 Client，每个 Client 与一个 Server 建立 1:1 关系。Server 可以是本地进程，也可以是远程服务。

## 2. MCP 解决什么问题

### 2.1 集成组合爆炸

没有共同协议时，每个 AI 应用都要为每个外部系统编写专用适配器：

```text
N 个 AI Host × M 个外部能力 → 大量成对集成
```

MCP 把共同边界标准化：

- Server 如何声明能力；
- Client 如何发现 Tool/Resource/Prompt；
- 参数和结果如何用 schema 描述；
- 如何调用、返回错误、取消、报告进度或订阅变化；
- 本地进程与远程 HTTP 如何传输消息；
- 协议版本和 capabilities 如何表达。

它不能消除每个外部系统的业务适配代码，但能让适配后的 Server 被不同 Host 复用。

### 2.2 Tool 之外的上下文交换

仅有函数调用通常关注“执行一个函数”。MCP 还把上下文分为不同原语：

- Resource：可读取的数据或内容；
- Prompt：可选择和参数化的消息/工作流模板；
- Tool：模型可选择调用的动作或查询函数。

这种区分让 Host 能针对不同风险和交互方式使用不同控制策略，而不是把所有外部能力都伪装成函数。

### 2.3 动态发现与复用

Server 可以通过标准 list 方法公布能力，Host 不必在编译时写死全部 Tool。当前规范中的典型方法包括：

```text
tools/list       tools/call
resources/list   resources/read   resources/templates/list
prompts/list     prompts/get
```

Server 还可以声明 list changed 或 resource subscription 等能力，使 Host 在受控条件下刷新能力集合。

### 2.4 协议边界而不是信任消除

MCP 使边界更清晰，但不会让边界自动安全。一个恶意 Server 仍可能：

- 给出误导性的 Tool 描述或 annotations；
- 请求过宽参数或返回 prompt injection；
- 利用本地进程权限读取文件；
- 把数据发送到远程服务；
- 通过 Tool 实现执行破坏性操作。

因此“符合 MCP”只说明协议兼容，不代表 Server 值得信任。

## 3. 为什么 Agent 需要 MCP

### 3.1 对 Agent 的实际价值

对于具备规划和 Tool 使用能力的 Agent，MCP 可以提供：

1. **能力发现**：运行时查询某个 Server 提供哪些 Tool/Resource/Prompt；
2. **统一契约**：用 JSON Schema 表达输入输出，减少 Host 对专有 API 的了解；
3. **生态复用**：同一个 Server 可以被多个兼容 Host 使用；
4. **上下文按需加载**：通过 Resource 和 Prompt 获取所需信息，而不是把全部数据预先塞入上下文；
5. **组合能力**：Host 可同时连接文件、数据库、代码分析和外部 SaaS Server；
6. **边界可观察**：协议请求、Tool 名称、参数和结果可以被记录、确认和审计。

### 3.2 Agent 仍然必须自己负责的部分

MCP 不会替 Agent 决定：

- 用户真正想完成什么；
- 何时应该调用 Tool；
- 哪个 Server 可信；
- 是否需要用户确认；
- Tool 是否应在 Sandbox 中运行；
- 结果是否可信或是否含恶意指令；
- 如何把 Observation 写回 Memory 和下一轮决策。

这些职责通常属于 Host、Agent Loop、Tool 执行层和安全策略。

### 3.3 何时不值得引入 MCP

以下情况可能直接 Tool 更合适：

- 只有一个 Host 和少量稳定的内部函数；
- Tool 与应用共享进程和类型系统，没有复用需求；
- 对延迟、部署复杂度或调试成本极度敏感；
- 外部能力不允许被动态发现；
- MCP SDK/Server 的供应链与权限成本高于互操作收益。

这是工程权衡，不是 MCP 能力不足的证明。

## 4. MCP 与 Function Calling 的区别

### 4.1 不在同一层

| 维度 | Function Calling / Tool Calling | MCP |
|---|---|---|
| 主要边界 | 模型 API 与 Host 应用之间 | Host 内 Client 与外部 Server 之间 |
| 主要问题 | 如何把可调用函数描述给模型，并接收模型生成的名称/参数 | 如何发现、描述、调用和传输外部能力与上下文 |
| Tool 来源 | Host 通常提前组装并发送给模型 | Client 可从 Server 的 `tools/list` 动态发现 |
| 执行协议 | 由模型提供商 API 和 Host 自定义 | 标准 JSON-RPC 方法，如 `tools/call` |
| 除 Tool 外能力 | 通常没有统一 Resource/Prompt 协议 | 原生定义 Resource、Prompt、Tool 等原语 |
| Transport/Auth | 通常不规定外部 Tool 的连接方式 | 定义 stdio、Streamable HTTP 和 HTTP Authorization 框架 |
| 安全保证 | 不自动保证 | 同样不自动保证；Host 仍需确认和隔离 |

### 4.2 两者如何配合

一个常见的适配链是：

```text
MCP Client 调用 tools/list
  → Host 把 MCP Tool schema 转成模型 API 的 function/tool schema
  → LLM 选择 Tool 并生成参数
  → Host 校验、授权并映射为 MCP tools/call
  → MCP Server 返回 CallToolResult
  → Host 转为模型可消费的 Tool result / Observation
```

所以，Function Calling 常是“模型如何提出调用”，MCP 是“Host 如何连接并调用外部能力”。MCP 可以为 Function Calling 提供 Tool 来源，但不会替代模型 API，也不要求所有 Host 必须使用某一家模型的 Function Calling 格式。

### 4.3 需要明确的推测边界

“Host 把 MCP Tool 转成某模型的 function schema”是常见实现模式，不是所有 MCP Host 都必须采用的规范要求。Host 也可以让用户直接选择 Prompt、应用主动读取 Resource，或用非 LLM 逻辑调用 Tool。

## 5. MCP 与 OpenHands Tool System 的关系

### 5.1 已确认的本地实现

根据本仓库的 [`OpenHands MCP 研究`](../../openhands-study/notes/09-mcp-integration.md) 与当前 Software Agent SDK 源码，OpenHands 原生支持作为 MCP Client/Consumer：

```text
外部 MCP Server
  → MCP Client 发现 tools/list
  → MCP Tool 转为 MCPToolDefinition
  → 注册进 OpenHands tools_map
  → LLM 选择 Tool
  → ActionEvent
  → MCPToolExecutor 发出 tools/call
  → MCPToolObservation
  → ObservationEvent
  → 下一轮 Agent 决策
```

OpenHands 的 `MCPToolDefinition` 是协议 Tool 到内部 `ToolDefinition` 的适配器，不是另一个 MCP Server。

### 5.2 两者的职责差异

| MCP | OpenHands Tool System |
|---|---|
| 定义 Client/Server 间能力交换协议 | 定义 Agent 如何注册、选择、执行和观察 Tool |
| Tool 可来自独立进程或远程服务 | Tool 最终统一成内部 ToolDefinition/Executor |
| 返回协议级 Tool result | 转换为 Action/Observation 并进入 EventLog |
| 要求 Host 负责同意和控制 | 可提供 ConfirmationPolicy、SecurityAnalyzer、Runtime/Workspace |

MCP 不替代 OpenHands Agent Loop；OpenHands 也不重新定义 MCP wire protocol。OpenHands 把 MCP Tool 作为其众多 Tool 来源之一。

### 5.3 安全与版本限制

- OpenHands Runtime 隔离本地执行，不会自动隔离远程 MCP Server；
- MCP Server 的 Tool schema、annotations 和结果仍是不可信外部输入；
- 本次没有运行 OpenHands 或 MCP Server；
- 之前 OpenHands 研究基于其固定 submodule 快照，本次未动态确认它对 `2026-07-28` stateless 协议的完整兼容性。

## 6. MCP 与 Agent Reach 的关系

### 6.1 Agent Reach 把 MCP 当作部分 backend

Agent Reach 的核心是 Skill、Channel 状态检查和 backend 路由。它通过 `mcporter` 调用部分外部 MCP Server，例如此前源码研究中的 Exa、xiaohongshu-mcp 和 LinkedIn 路径。

简化关系：

```text
用户任务
  → Agent Reach Skill/Channel 判断使用哪个平台和 backend
  → mcporter 作为 MCP Client/桥接器
  → 外部 MCP Server
  → Tool result 回到宿主 Agent
```

Agent Reach 回答“这次应该走哪个能力路径”；MCP 回答“Client 与 Server 如何描述和交换能力调用”。

### 6.2 不要混淆两个 MCP 角色

Agent Reach 还包含一个自身 MCP Server，但此前源码确认它只暴露只读的 `get_status`，用于返回 doctor 状态。它不代理所有外部平台 Tool。

因此：

- Agent Reach 作为使用方：借助 mcporter 调外部 MCP Server；
- Agent Reach 作为提供方：只暴露有限状态 Tool；
- Agent Reach 不是通用 MCP Gateway，也不是统一 Tool Executor。

### 6.3 信任边界

Agent Reach 对 mcporter 配置的检查不能证明外部 Server 身份、实现安全、Tool schema 或结果可信。引入 MCP 标准不会自动解决 Agent Reach 已识别的 Cookie、Token、远端服务、供应链和 prompt-injection 风险。

## 7. MCP 与 REA 的关系

### 7.1 REA 是领域 MCP Server 的具体实例

REA（Reverse Engineer Anything）不只是可被 REA 分析的代码项目。根据 [`REA 项目概览`](../../rea-study/notes/01-overview.md) 和 [`REA 架构分析`](../../rea-study/notes/03-architecture.md)，它自身可以通过 stdio 运行 MCP Server：

```text
Agent Host / MCP Client
  → REA MCP Server
  → 分析 Tool
  → application workflow
  → provider / artifact reader
  → normalized result + Evidence
  → MCP Tool result
```

这展示了 MCP 的典型用途：把一个复杂领域系统包装为标准 Tool，让兼容 Agent 不必理解其内部 provider、会话和 Evidence 实现。

### 7.2 MCP 与 REA Evidence 不同

- MCP 规定消息、Tool schema、调用和内容块；
- REA Evidence 是其业务领域定义的可追溯记录，包含目标、provider、参数、位置、限制和关联证据；
- MCP 可以承载 REA Evidence，但不会自动为任何 Tool result 生成同等强度的来源证明。

不能因为结果经 MCP 返回，就把它当成已有 Evidence 或已验证事实。

### 7.3 REA 作为本次源码分析辅助的边界

官方 MCP 仓库的 schema 是 TypeScript，REA 理论上可辅助查看 TypeScript 模块关系。但协议含义主要位于 Markdown/MDX 规范，REA 的 JavaScript/TypeScript 静态关系无法替代人工阅读规范关键词、版本差异和安全条款。

本阶段没有运行 REA，也没有启动其 MCP Server。

## 8. MCP 核心组成

### 8.1 Host（必须补充）

Host 是面向用户的 LLM 应用、IDE 或 Agent 平台，负责：

- 创建和管理多个 MCP Client；
- 决定可以连接哪些 Server；
- 集成 LLM/Agent；
- 汇总不同 Client 的上下文；
- 执行用户同意、授权和安全策略；
- 防止一个 Server看到完整对话或其他 Server 的数据。

MCP 的安全原则主要由 Host 落实，而不是由协议自动强制。

### 8.2 Client

Client 是 Host 内的协议连接器。当前架构规定一个 Client 与一个 Server 通信，并负责：

- 在每个请求附带协议版本与 capabilities；
- 双向路由协议消息；
- 管理订阅和 notification；
- 在 Server 之间维持安全隔离；
- 把 Server 能力交给 Host 使用。

Client 不是模型，也不等于 Agent。

### 8.3 Server

Server 是提供专门上下文与能力的本地进程或远程服务。它可以暴露：

- Tool；
- Resource；
- Prompt；
- 当前规范允许的其他 capability 或扩展。

Server 应职责聚焦、可组合，并只接收完成调用所需的信息。它不能因为采用 MCP 就默认获得整个对话历史。

### 8.4 Tool

Tool 是 Server 暴露、供模型选择执行的函数。当前规范通过：

```text
tools/list → 发现 Tool
tools/call → 调用 Tool
```

Tool 通常包含：

- 唯一名称和描述；
- `inputSchema`；
- 可选 `outputSchema`；
- annotations；
- text、image、audio、resource link、embedded resource 或 structured content 等结果。

官方把 Tool 描述为 model-controlled，但 Host 仍应在敏感操作前要求用户确认。Tool annotations 只是提示；来自不可信 Server 时不能作为安全决策依据。

### 8.5 Resource

Resource 是由 Server 暴露的结构化数据或内容，使用 URI 标识。典型方法：

```text
resources/list
resources/read
resources/templates/list
```

Resource 可表示文件内容、Git 历史、数据库 schema 或其他上下文。官方把它描述为 application-controlled：通常由 Host/Client 决定何时读取并把哪些内容加入模型上下文。

Server 可以提供参数化 Resource Template，也可以在声明 capability 后支持变化通知或订阅。Client 和 Server 都必须校验 URI，不能把任意 URI 自动视为安全。

### 8.6 Prompt

Prompt 是 Server 提供的预定义消息或工作流模板。典型方法：

```text
prompts/list
prompts/get
```

Prompt 可以声明参数，返回 text、image、audio、resource link 或 embedded resource 等消息内容。官方把 Prompt 描述为 user-controlled，典型表现是用户从菜单、命令或 UI 主动选择模板。

Prompt 不是 System Prompt 的同义词，也不保证内容安全。Host 应展示来源、参数与结果，并把外部 Prompt 当作不可信输入处理。

### 8.7 三类 Server 原语对比

| 原语 | 官方控制模型 | 主要用途 | 典型方法 | 主要风险 |
|---|---|---|---|---|
| Tool | Model-controlled | 执行动作或查询 | `tools/list`, `tools/call` | 代码执行、写操作、外部副作用 |
| Resource | Application-controlled | 提供上下文数据 | `resources/list`, `resources/read` | 数据泄露、越权读取、恶意内容 |
| Prompt | User-controlled | 提供模板化消息/工作流 | `prompts/list`, `prompts/get` | 指令注入、来源混淆、参数泄露 |

“controlled”描述典型交互主体，不等于该主体可以绕过 Host 的权限和安全策略。

## 9. 一次 MCP Tool 调用如何进入 Agent

以通用 Host 为例：

```text
Host 创建 Client
  → 可选 server/discover
  → Client 请求 tools/list
  → Server 返回 Tool schema
  → Host 把 Tool 暴露给 LLM/用户
  → LLM 或用户选择 Tool
  → Host 校验参数、权限和用户确认
  → Client 发送 tools/call
  → Server 执行业务逻辑
  → 返回 CallToolResult
  → Host 转成 Tool result / Observation
  → LLM 根据结果继续决策
```

当前 `2026-07-28` 规范中，每个请求自带协议版本和 Client capabilities；不能照搬旧版“必须先 initialize 并保持 Session”的流程。

## 10. 风险与隐藏成本

### 10.1 权限和信任

- 本地 stdio Server 是宿主启动的子进程，可能继承用户文件和进程权限；
- 远程 HTTP Server 会看到 Host 发送的参数、Resource 和认证信息；
- MCP schema 只约束消息形状，不能证明实现与描述一致；
- Tool result、Resource 和 Prompt 都可能携带恶意或误导内容；
- Server 名称、Tool 名称和来源需要明确 provenance，避免同名混淆。

### 10.2 版本与兼容

- MCP 使用日期版本，不是语义版本；
- `2026-07-28` 与 `2025-11-25` 的生命周期、Session 和消息方向存在重要差异；
- Host、SDK 与 Server 可能支持不同版本或只实现一部分 capability；
- “使用 MCP SDK”不能替代真实的版本和 capability 兼容测试。

### 10.3 运维成本

- 本地 Server 需要进程生命周期、路径、环境变量和日志管理；
- 远程 Server 需要 TLS、Authorization、超时、限流和可用性管理；
- 动态 Tool 列表会影响 LLM 上下文、Tool 冲突和 prompt cache；
- 多 Server 组合会扩大供应链、数据流和故障排查范围。

## 11. 已确认事实、合理推测与未验证信息

### 11.1 已确认事实

- 官方推荐的规范仓库仍为 `modelcontextprotocol/modelcontextprotocol`；
- 该仓库包含规范、TypeScript/JSON schema 和官方文档，不是 Server 应用；
- 当前仓库包含正式的 `2026-07-28` 规范；
- MCP 使用 Client–Host–Server 架构和 JSON-RPC 2.0；
- 当前 core 是 stateless，每个请求携带版本和 capabilities；
- Server 核心原语包括 Tool、Resource 和 Prompt；
- OpenHands 固定源码包含 MCP Client、ToolDefinition 适配与 Tool 执行链；
- Agent Reach 的部分 Channel 借助 mcporter/MCP Server，且自身 MCP 只暴露有限状态能力；
- REA 可作为 stdio MCP Server 暴露分析 Tool。

### 11.2 合理推测

- MCP 对 Agent 生态的最大价值是降低 Host 与能力提供者之间的重复适配成本；
- OpenHands 适合承担 Host/Agent Loop，Agent Reach 适合承担能力选择，REA 适合承担领域分析 Server；
- 将三者组合时，MCP 是协议桥梁而不是最高层调度器；
- 对小型单体 Agent，直接原生 Tool 可能比引入 MCP 更经济。

### 11.3 主观建议

1. 学习时先掌握 Host/Client/Server 和三类原语，再看 SDK；
2. 每次记录协议版本，避免把旧 handshake 教程混入当前 stateless 规范；
3. 第一个动态实验只做本地、无账号、只读 Resource 或纯函数 Tool；
4. 外部 Server 固定版本并审核启动命令、访问目录、网络与凭据；
5. Host 对 Tool 调用设置 allowlist、参数校验、确认、超时、输出上限和审计；
6. 把 MCP 返回内容当作外部不可信数据，而不是系统指令。

### 11.4 未验证信息

- 未运行任何 MCP Client/Server 或 SDK 示例；
- 未验证 stdio 或 Streamable HTTP 的真实消息序列；
- 未验证 Authorization、版本协商、订阅和 multi round-trip request；
- 未验证 OpenHands、Agent Reach、REA 对 `2026-07-28` 的动态兼容性；
- 未验证任何第三方 MCP Server 的安全性、隐私政策或账号权限；
- 未使用 REA 分析本次官方仓库；
- 未安装 Node/npm 包，未构建官方规范网站或 schema。

## 12. 关键源码与规范索引

| 主题 | 文件 |
|---|---|
| 仓库定位 | [`README.md`](../servers/modelcontextprotocol/README.md) |
| 最新规范总览 | [`docs/specification/2026-07-28/index.mdx`](../servers/modelcontextprotocol/docs/specification/2026-07-28/index.mdx) |
| Client–Host–Server 架构 | [`architecture/index.mdx`](../servers/modelcontextprotocol/docs/specification/2026-07-28/architecture/index.mdx) |
| JSON-RPC 与 stateless core | [`basic/index.mdx`](../servers/modelcontextprotocol/docs/specification/2026-07-28/basic/index.mdx) |
| Transport | [`basic/transports/index.mdx`](../servers/modelcontextprotocol/docs/specification/2026-07-28/basic/transports/index.mdx) |
| Server 原语 | [`server/index.mdx`](../servers/modelcontextprotocol/docs/specification/2026-07-28/server/index.mdx) |
| Tool | [`server/tools.mdx`](../servers/modelcontextprotocol/docs/specification/2026-07-28/server/tools.mdx) |
| Resource | [`server/resources.mdx`](../servers/modelcontextprotocol/docs/specification/2026-07-28/server/resources.mdx) |
| Prompt | [`server/prompts.mdx`](../servers/modelcontextprotocol/docs/specification/2026-07-28/server/prompts.mdx) |
| TypeScript schema | [`schema/2026-07-28/schema.ts`](../servers/modelcontextprotocol/schema/2026-07-28/schema.ts) |
| JSON Schema | [`schema/2026-07-28/schema.json`](../servers/modelcontextprotocol/schema/2026-07-28/schema.json) |
| OpenHands MCP 研究 | [`openhands-study/notes/09-mcp-integration.md`](../../openhands-study/notes/09-mcp-integration.md) |
| Agent Reach Tool/MCP 研究 | [`agent-reach-study/notes/03-skill-tool-flow.md`](../../agent-reach-study/notes/03-skill-tool-flow.md) |
| REA 概览 | [`rea-study/notes/01-overview.md`](../../rea-study/notes/01-overview.md) |
