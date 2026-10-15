# MCP 架构与真实调用流程

> - 研究日期：2026-10-14
> - 官方仓库：`modelcontextprotocol/modelcontextprotocol`
> - submodule 提交：`5ea996028df322ce97d1c906731cf8c05a6e268e`
> - 当前研究基线：正式规范 `2026-07-28`
> - 历史对照：正式规范 `2025-11-25`
> - 方法：官方规范、TypeScript schema、OpenHands、Agent Reach 与 REA 本地源码/既有研究笔记的静态阅读
> - 未安装依赖、未启动 MCP Server、未连接账号、未修改官方源码

## 0. 前提修正与结论

用户给出的流程：

```text
Host
  ↓
MCP Client
  ↓
Transport
  ↓
MCP Server
  ↓
Tool / Resource / Prompt
```

作为分层心智模型基本正确，但需要修正两点：

1. **Client 与 Server 是经 Transport 双向交换 JSON-RPC 消息，不是 Transport 单向把 Client “传给” Server。** Host 通常包含一个或多个 Client；每个 Client 只对应一个 Server。
2. **`initialize → notifications/initialized` 不是当前 `2026-07-28` 规范的初始化流程。** 当前规范已采用 stateless core，每个请求携带协议版本、Client capabilities 和可选 Client identity。该握手属于 `2025-11-25` 及更早版本。官方仍定义兼容探测，但不能把旧生命周期当成当前协议事实。

本章的核心结论：

- MCP 规定的是 **Host/Client/Server 之间如何发现和调用能力**；
- LLM 为什么选择某个 Tool、是否需要用户确认、结果如何进入 Agent 记忆，主要由 Host/Agent 实现决定；
- Tool 描述、Server identity 和返回内容都不能仅因“来自 MCP”而被视为可信；
- 当前规范的主要交互单位是自包含 request，不是隐式连接会话。

## 1. MCP 整体架构

### 1.1 Host

#### 【源码确认事实】

当前官方 [`architecture/index.mdx`](../servers/modelcontextprotocol/docs/specification/2026-07-28/architecture/index.mdx) 将 Host 定义为容器与协调者。Host：

- 创建并管理多个 MCP Client；
- 控制 Client 的连接权限与生命周期；
- 执行安全策略和用户同意要求；
- 处理用户授权决策；
- 协调 AI/LLM、sampling 与 MCP 能力；
- 汇总多个 Client 返回的上下文；
- 保留完整对话，并控制每个 Server 实际能看到的内容。

Host 可能是 IDE、桌面 AI 应用、Agent 框架或其他集成 MCP 的应用。**MCP 不把 Host 等同于 LLM。** LLM 通常只是 Host 中参与规划或选择 Tool 的组件。

### 1.2 Client

#### 【源码确认事实】

一个 Client 由 Host 创建，并与恰好一个 Server 通信：

- 把协议版本和 Client capabilities 附在每个当前版请求上；
- 发送请求、接收响应，路由 notification；
- 管理订阅与变更通知；
- 在多个 Server 之间维持隔离边界；
- 通过 stdio 或 Streamable HTTP 等 Transport 承载消息。

Client 是协议参与者和连接适配器，不自动等于 Agent planner、权限系统或 Tool executor。Host 可以在 Client 返回能力后，选择只暴露其中一部分给 LLM。

### 1.3 Server

#### 【源码确认事实】

Server 提供聚焦的外部能力：

- 暴露 Tool、Resource 和 Prompt；
- 响应 `server/discover`、`tools/list`、`tools/call` 等自己支持的方法；
- 按请求中携带的授权信息和 capabilities 处理访问；
- 可通过 `InputRequiredResult` 要求 Host/Client 补充 sampling、elicitation、roots 等输入；
- 可以是 Client 启动的本地进程，也可以是独立远端服务。

Server 不应获得完整对话或其他 Server 的内容；Host 决定给它哪些参数和上下文。Tool 的业务执行可能直接发生在 Server 进程，也可能由 Server 再调用数据库、SaaS API 或其他后端。

### 1.4 职责边界

| 问题 | 主要责任方 | 边界说明 |
|---|---|---|
| 用户授权/同意 | Host | 当前架构明确由 Host 处理用户授权决策和 consent；远端 Server 仍必须验证访问令牌和自身授权规则。 |
| Client 生命周期 | Host | Host 创建、管理和关闭 Client。 |
| Transport 生命周期 | Host/Client + Server | Client 建立/关闭通信；stdio 下 Client 启动子进程，Server 处理自身资源释放；HTTP Server 是独立服务。 |
| 协议版本与 capabilities | Client + Server | 当前每个请求带 Client 版本/能力；Server 可通过 `server/discover` 返回支持版本与能力。 |
| 权限控制 | Host + Server，分层负责 | Host 决定能否连接、向模型暴露什么、是否批准调用；Server 按凭据/范围实施资源访问控制。MCP 本身不是 Sandbox。 |
| Tool 选择 | 通常是 Host 内的 LLM/Agent | MCP 将 Tool 定义为 model-controlled，但不规定具体模型、提示词或选择算法。 |
| Tool 调用 | Client 发协议请求；Server 执行业务能力 | Client 发送 `tools/call`；Server 验证参数/权限并执行或转发。 |
| 数据返回 | Server → Client → Host | MCP 规范 Tool result；是否写入 UI、LLM context、EventLog 或 Memory 由 Host 决定。 |
| 完整对话与跨 Server 汇总 | Host | Server 原则上只接收完成当前请求所需的信息。 |

#### 【合理推测】

安全设计上，应把 Host 看作“策略执行点”，把 Server 看作“能力与数据的执行边界”。只在其中一侧做权限检查不够：Host 无法替 Server 判断数据库行级权限，Server 也无法替 Host 判断本次用户意图是否授权了删除或外发操作。

#### 【未验证】

本次没有运行任何具体 Host，因此没有验证某个产品是否真的做到 Server 隔离、逐次确认、最小上下文披露或凭据分离。

## 2. MCP 生命周期与版本差异

### 2.1 当前 `2026-07-28`：无初始化握手

#### 【源码确认事实】

当前 [`basic/versioning.mdx`](../servers/modelcontextprotocol/docs/specification/2026-07-28/basic/versioning.mdx) 明确写明：**没有 negotiation handshake**。每个请求通过 `_meta` 自带：

- `io.modelcontextprotocol/protocolVersion`；
- `io.modelcontextprotocol/clientCapabilities`；
- 可选的 `io.modelcontextprotocol/clientInfo`。

Server 若不支持请求版本，返回 `UnsupportedProtocolVersionError`；Client 可以选择双方共同支持的版本重试。Client 也可以先调用 `server/discover`，一次获得：

- `supportedVersions`；
- Server `capabilities`；
- `_meta.io.modelcontextprotocol/serverInfo`；
- 可选 `instructions`。

因此当前流程更准确地表示为：

```text
Host 创建 Client
  → Client 建立 Transport
  → 可选 server/discover
  → 任意协议请求（每次都携带版本与 Client capabilities）
  → Server 返回结果或 UnsupportedProtocolVersionError
  → 可选按共同版本重试
  → Host/Client 在需要时关闭 Transport
```

“stateless”不表示 Server 进程不能有缓存、数据库或任务，也不表示不能开长连接通知流；它表示 Server 不能从此前连接/请求**隐式推断**当前请求所需的协议版本、capabilities 或身份。跨请求状态必须有显式标识和协议语义。

### 2.2 历史 `2025-11-25`：`initialize` 与 `initialized`

#### 【源码确认事实】

用户要求研究的初始化链存在于 [`2025-11-25/basic/lifecycle.mdx`](../servers/modelcontextprotocol/docs/specification/2025-11-25/basic/lifecycle.mdx) 和对应 [`schema.ts`](../servers/modelcontextprotocol/schema/2025-11-25/schema.ts)：

```text
Client → Server: initialize
  params:
    protocolVersion
    capabilities
    clientInfo

Server → Client: InitializeResult
  result:
    protocolVersion
    capabilities
    serverInfo
    instructions?

Client → Server: notifications/initialized
```

规则包括：

- `initialize` 必须是 Client 与 Server 的第一次协议交互；
- Client 提出期望版本和 Client capabilities；
- Server 返回选定版本、Server capabilities 与 Server info；
- Client 若不支持 Server 选定的版本，应断开；
- Client 发送 `notifications/initialized` 后进入正常 Operation 阶段；
- capabilities 在该 session 内作为后续功能边界。

### 2.3 为什么必须保留两套心智模型

当前 [`versioning.mdx`](../servers/modelcontextprotocol/docs/specification/2026-07-28/basic/versioning.mdx) 将协议分为：

- Modern：`2026-07-28` 及以后，使用 per-request metadata；
- Legacy：`2025-11-25` 及以前，使用 `initialize` session；
- Dual-era：同时支持两者。

stdio 下，Dual-era Client 建议先用 `server/discover` 探测；遇到不属于现代规范的错误或超时，再按规则回退到 `initialize`。这属于兼容逻辑，不代表现代请求先 `initialize`。

#### 【合理推测】

学习旧 SDK 或现有产品代码时，仍会频繁看到 `initialize`、session ID、Server 发起 JSON-RPC request 等旧时代结构。分析时必须先锁定其 MCP SDK 与协议版本，否则容易把实现兼容层误认为当前标准流程。

#### 【未验证】

本阶段没有做 Dual-era 互操作实验，也没有验证 OpenHands、Agent Reach 使用的第三方 Client 或 REA 发布版是否已经支持 `2026-07-28`。

## 3. 能力发现流程

### 3.1 先发现能力类别，再取得具体清单

#### 【源码确认事实】

当前规范提供两层发现：

1. `server/discover`：查询 Server 支持的协议版本、能力类别和自报 identity；
2. 具体 list 方法：查询每一类能力的实际条目。

| 请求 | 返回内容 | 后续使用 |
|---|---|---|
| `tools/list` | Tool name、description、`inputSchema`、可选 `outputSchema`/annotations 等 | Host 转换成模型可选择的 Tool 定义；调用时使用 `tools/call`。 |
| `resources/list` | Resource URI、name、description、MIME 等 | 应用选择后以 `resources/read` 读取；模板另用 `resources/templates/list`。 |
| `prompts/list` | Prompt name、description、arguments | 用户/应用选择后以 `prompts/get` 取得结构化 messages。 |

Server 声明相应 capability 后必须响应对应 list 请求。列表可以为空，也可随时间变化；若声明 `listChanged` 并建立相应 subscription，Server 可以发送列表变化 notification，Client 再重新 list。

当前控制模型不是“三种能力都由 Agent 自动选”：

- Tool：model-controlled；
- Resource：application-controlled；
- Prompt：user-controlled。

这描述默认交互语义，不强迫所有 Host 使用同一种 UI。

### 3.2 Agent 如何知道 Server 有什么能力

完整过程是：

```text
Host 配置/允许连接某个 Server
  → MCP Client（可选）调用 server/discover
  → Client 根据 capabilities 调用 tools/list / resources/list / prompts/list
  → Client 解析并验证 Server 返回的定义
  → Host 决定允许、过滤、重命名或适配哪些能力
  → Host 把 Tool schema 或可用资源/Prompt 呈现给 LLM、应用或用户
  → LLM/用户/应用按各自控制模型选择能力
```

所以“Agent 知道能力”不是 Server 直接把自己注入模型。中间至少存在 Client 发现、Host 策略与模型上下文构造三步。

#### 【源码确认事实】

- `server/discover` 对 Server 是必需实现，对 Client 是可选调用；Client 也可以直接调用具体 RPC 并处理版本错误。
- `serverInfo` 是 Server 自报信息，只用于展示、日志和调试，不应作为安全身份。
- Tool annotations 若来自不可信 Server，Client 必须视为不可信。
- Tool name 只在单个 Server 内唯一；聚合多个 Server 的 Host 需要处理重名。

#### 【合理推测】

生产 Host 通常需要在把 Tool 放进 LLM 上下文前做 allowlist、命名空间、schema 校验、风险标记和 token-budget 筛选。协议允许发现，不代表 Host 应将所有发现项无条件暴露给模型。

#### 【未验证】

没有验证当前研究环境中任一 Server 的动态列表变化、分页、缓存 TTL 或订阅行为。

## 4. Tool 调用流程

### 4.1 协议内与协议外的边界

#### 【源码确认事实】

MCP 协议内的核心链路是：

```text
MCP Client
  → tools/call { name, arguments }
  → MCP Server 验证权限、Tool 名称和参数
  → Tool/后端执行
  → CallToolResult { content, structuredContent?, isError? }
  → MCP Client
```

用户给出的完整 Agent 链路则包含协议外行为：

```text
用户需求
  → Host 构造 Agent/LLM 上下文                       [Host]
  → LLM 根据已暴露的 Tool 定义决定调用             [Host/LLM]
  → Host 做策略检查、风险判断和必要的用户确认       [Host]
  → MCP Client 发送 tools/call                     [MCP]
  → Transport 承载 JSON-RPC                         [MCP]
  → MCP Server 验证并执行 Tool                      [MCP + Server 业务]
  → Tool result 返回 Client                         [MCP]
  → Host 校验、裁剪或转换结果                        [Host]
  → 结果进入 Agent context/EventLog/Observation     [Host/Agent 实现]
  → LLM 进行下一轮推理                               [Host/LLM]
```

MCP 规范把 Tool 定义为 model-controlled，但不定义：

- LLM 的选择算法；
- Agent 的 planning/reflection loop；
- 名为 `ObservationEvent` 的统一对象；
- Tool result 必须永久写入 Memory；
- 所有调用都自动获准执行。

### 4.2 结果与错误

#### 【源码确认事实】

Tool result 可含文本、图像、音频、resource link、embedded resource 和结构化内容。业务执行错误可用 `isError: true` 返回；规范建议 Client 把 Tool execution error 提供给 LLM，以支持自我修正。协议/参数层错误则使用 JSON-RPC error。

若 Server 还需要用户输入、sampling 或 roots，当前规范可以返回 `InputRequiredResult`；Client 获得输入后，以新的 JSON-RPC id、原始参数和 `inputResponses` 重试。这不是 Server 在当前 Transport 上任意发起一个反向 JSON-RPC request。

#### 【合理推测】

“Tool result 进入 Agent 上下文”应先经过结构/schema、长度、敏感信息、来源和不可信指令检查。直接拼接远端文本虽简单，但会扩大 prompt injection 和 context pollution 风险。

#### 【未验证】

未执行真实 `tools/call`，因此没有验证具体 Server 的输出 schema、错误语义、重试幂等性或副作用。

## 5. Transport

### 5.1 两种标准 Transport

#### 【源码确认事实】

| 维度 | stdio | Streamable HTTP |
|---|---|---|
| Server 形态 | Client 启动的本地子进程 | 独立本地或远端 HTTP 服务，可服务多个 Client |
| 消息通道 | `stdin`/`stdout` 上逐行 JSON-RPC | 单一 MCP endpoint；每条 request/notification 是独立 HTTP POST |
| 响应 | 同一 stdout 通道上的 JSON-RPC response/notification | 单个 JSON 对象，或仅作用于该请求的 SSE stream |
| 日志 | Server 可写 `stderr`，不得把非 MCP 内容写入 `stdout` | 使用常规服务日志；不能混入协议 response body |
| 取消 | Client 发 `notifications/cancelled` | Client 关闭该请求的 SSE response stream |
| 通知 | 共用 stdout；订阅消息带 subscription id | `subscriptions/listen` 打开长连接 SSE stream |
| 当前 session | 无协议级 session | `2026-07-28` 已移除协议级 session 与独立 GET stream |
| 常见场景 | 本机工具、编辑器插件、受控子进程 | 远端共享服务、组织级能力、网络 API gateway |

Streamable HTTP 的当前安全要求包括：

- Server 必须校验 `Origin`，无效时返回 403，以防 DNS rebinding；
- 本地运行时应只绑定 localhost，而非所有网卡；
- Server 应为所有连接实施正确认证；
- 每个 POST 必须携带 `MCP-Protocol-Version`，并与消息体的版本 metadata 一致。

### 5.2 安全风险差异

| Transport | 主要风险 | 关键控制 |
|---|---|---|
| stdio | 启动命令/package 即本地代码执行；继承当前用户文件、环境变量与网络权限；恶意依赖可直接窃取数据 | 固定来源与版本、启动命令 allowlist、最小环境变量、受限工作目录、低权限用户、Sandbox/容器、启动前用户确认 |
| Streamable HTTP | 凭据和业务数据出机；Token 被盗/误投递；DNS rebinding、SSRF、恶意远端服务、TLS/代理信任问题 | HTTPS、Origin 校验、认证与 audience 校验、最小 scope、Server allowlist、请求/响应审计、敏感数据出站控制 |

#### 【合理推测】

stdio 不等于“更安全”，只是信任边界从网络服务转成了本地进程与供应链；Streamable HTTP 也不等于“更危险”，它更容易集中实施认证、更新和审计，但增加了网络、租户和数据驻留风险。实际选择应按能力位置和隔离要求决定。

#### 【未验证】

本阶段未启动任何 Transport，未检查本机端口、证书、代理、OAuth flow 或子进程权限。

## 6. 与已有研究对比

### 6.1 MCP vs OpenHands Tool System

| 维度 | MCP | OpenHands Tool System |
|---|---|---|
| Tool 定义 | Server 通过 `tools/list` 返回 name、description、JSON Schema 等 | `ToolDefinition` 绑定 Action、Observation、executor 和 LLM schema；MCP Tool 被适配为 `MCPToolDefinition` |
| 调用流程 | Client `tools/call` → Server → `CallToolResult` | LLM Tool Call → `ActionEvent` → security/confirmation → executor → `ObservationEvent` |
| 权限控制 | Host 决定暴露/批准；Server 按凭据和访问规则执行 | Conversation 的 SecurityAnalyzer、ConfirmationPolicy 与 Runtime 共同控制；具体配置决定强度 |
| 状态管理 | 当前 core 无状态；显式 request state、task、subscription 等另行表达 | EventLog、Conversation state、Agent state 和 Workspace/Runtime 状态持续参与循环 |
| Observation 处理 | MCP 没有统一 `ObservationEvent`；只返回 Tool result | `MCPToolExecutor` 把结果转成 `MCPToolObservation`，再进入 EventLog 与下一轮 LLM 上下文 |

#### 【源码确认事实】

本地 OpenHands 研究已确认其 Python SDK 通过 FastMCP Client 执行 `list_tools()` / `call_tool_mcp()`，把 MCP Tool 转成 `MCPToolDefinition`，最终把 `MCPToolObservation` 放入自身事件模型。也就是说，**MCP 提供跨进程/服务协议，OpenHands 提供 Agent 执行语义。**

#### 【未验证】

没有验证该 OpenHands 快照与 MCP `2026-07-28` 的运行时兼容性，也没有启动其确认策略或 Runtime Sandbox。

### 6.2 MCP vs Agent Reach

| 维度 | MCP | Agent Reach |
|---|---|---|
| Skill | 无 Skill 概念 | Markdown Skill 告诉宿主 Agent 何时选择渠道、命令和降级策略 |
| Channel | 无平台健康状态抽象 | Python `Channel` 描述候选 backend、状态和 `active_backend` |
| MCP Server | 标准能力提供端 | 只是部分 Channel 的外部 backend；不代表全部 Agent Reach 能力 |
| 外部能力 | 通过统一 JSON-RPC 原语发现/调用 | 多数由宿主直接运行 `gh`、`curl`、OpenCLI、平台 CLI；部分经 `mcporter` 调 MCP |
| 结果状态 | 标准 result/error；更高层状态由 Host 决定 | Channel 检查是进程内暂态，不是统一 Action/Observation EventLog |

#### 【源码确认事实】

Agent Reach 使用 `mcporter` 作为外部 MCP Client/CLI 桥接器，负责读取 Server 配置、连接 Server 并把命令行 tool name/参数转成调用。Agent Reach 的 Skill 与 Channel 本身都不是 MCP 协议原语。

#### 【合理推测】

两者可以组合为：Agent Reach Skill/Channel 决定“本次用哪个 backend”，mcporter/MCP 决定“如何发现并调用该外部能力”。前者偏路由与操作手册，后者偏互操作协议。

#### 【未验证】

此前 Agent Reach 最小实验明确禁用了 MCP，本章也没有运行 mcporter；其当前 MCP 协议版本、实际 Server identity 和 Tool schema 未验证。

### 6.3 MCP vs REA

| 维度 | MCP | REA |
|---|---|---|
| 主要问题 | 跨 Host/Server 连接、发现和调用能力 | 理解代码与制品，统一多 provider 分析并保留 Evidence |
| 输出契约 | Tool/Resource/Prompt 与 JSON-RPC result | 语义图、分析结果、unknown/limitations、Evidence 与定位信息 |
| 与对方关系 | 可承载 REA 暴露的分析工具 | 可作为 stdio MCP Server，也能分析部分 MCP 相关 JS/TS 源码 |
| 不替代什么 | 不替代代码理解和来源证明 | 不替代 MCP Transport、授权和 Host Tool 接入 |

#### 【源码确认事实】

REA 的 CLI 与 MCP 入口共用 application/composition 层；MCP 只是其一个调用适配层。REA 的 Evidence 记录 provider、目标、参数、限制和位置，而 MCP 通用 Tool result 并不强制所有 Server 提供同等级别的 provenance。

#### 【合理推测】

在研究型 Agent 中，MCP 适合统一“能力连接”，REA 适合提高“代码结论可追踪性”。把 REA Tool 通过 MCP 接入 OpenHands，可以形成“Agent loop + 标准能力接口 + Evidence”的组合，但仍需要 Host 做权限、上下文与结果验证。

#### 【未验证】

没有验证 REA 当前源码/发布版与 MCP `2026-07-28` 的运行时兼容性，也没有在本阶段调用 REA MCP Server。

## 7. 安全模型

### 7.1 风险与边界

| 风险 | 【源码确认事实】 | 【合理推测】 | 建议控制 |
|---|---|---|---|
| 恶意 MCP Server | `serverInfo` 是自报信息；Tool annotations 来自不可信 Server 时不能信任；Client 应验证结果 | Server 可用诱导性描述、恶意结果、OAuth URL 或本地启动载荷攻击 Host | 固定来源/版本、Server allowlist、签名/哈希、隔离运行、结果视为不可信输入 |
| Tool 权限过大 | Host 负责 consent；Server 负责 access control；规范建议敏感操作确认并展示输入 | 一个“通用 shell/files/api” Tool 会把多个权限域合并成高爆炸半径能力 | 最小 Tool 面、最小 scope、只读优先、参数 allowlist、每次高风险操作确认 |
| Token 泄露 | 当前授权规范要求安全存储、短期 token、audience validation，并禁止把 Client 给 MCP Server 的 token 原样透传给上游 API | 日志、环境变量、错误回显、错误 Server 或代理都可能泄露凭据 | 每 Server/issuer 分离凭据、秘密引用、日志脱敏、短期 token、撤销与轮换 |
| Prompt Injection | Prompt 输入/输出必须验证以防 injection；Tool result 在进入 LLM 前应验证 | Resource、Prompt、网页和 Tool result 都可能把外部指令伪装为数据，诱导 Agent 调用其他 Tool | 数据/指令分层、来源标记、禁止结果自动授权、敏感 Tool 二次确认、上下文裁剪 |
| 数据外流 | 规范建议在调用前向用户显示 Tool 输入，以防恶意或意外 exfiltration | 参数可能包含对话、源码、Token、私有 URL；远端 Tool result 也可能要求继续上传更多信息 | 出站内容检查、字段级脱敏、目标域 allowlist、本地处理优先、审计 |

### 7.2 协议保证的上限

#### 【源码确认事实】

当前规范明确要求或建议：

- Server 验证 Tool 输入、实施访问控制、限流并净化输出；
- Client 在敏感调用前确认，展示 Tool 输入，验证 Tool result，设置 timeout 并记录审计日志；
- Resource Server 验证 URI、检查权限并防目录穿越；
- Prompt 输入/输出需防 injection 与未授权资源访问；
- Streamable HTTP Server 校验 Origin、使用认证并在本地仅绑定 localhost；
- OAuth Token 必须绑定目标资源，不允许 token passthrough。

但 MCP 是协议规范，不会自动在每个实现中生成 Sandbox、审批 UI、DLP、恶意内容检测或可靠 Evidence。

### 7.3 分层防御建议

#### 【主观建议】

1. **连接前**：只启用明确来源、固定版本、可审计的 Server；stdio 启动命令按本地代码执行审查。
2. **发现后**：不要把所有 Tool 自动交给 LLM；做 Server 命名空间、Tool allowlist、schema 与风险等级检查。
3. **调用前**：向用户展示目标 Server、Tool、关键参数、数据出站范围和副作用；高风险操作逐次确认。
4. **执行中**：最小文件/网络/账号权限，设置 timeout、速率和资源限制；本地 Server 放进受限环境。
5. **返回后**：把 Tool result 当作不可信数据，验证结构、来源与敏感内容；不要让返回文本绕过下一次授权。
6. **审计与撤销**：记录调用、参数摘要、结果状态与用户批准；Token 可单独吊销，Server 配置可快速禁用。

### 7.4 本次未验证

#### 【未验证】

- 任一 MCP Server 的真实身份、代码签名、部署方和数据保留政策；
- 任一 Host 是否正确实现 Tool 过滤、用户确认、结果校验和日志脱敏；
- stdio Server 的 OS 权限、网络权限和 Sandbox；
- Streamable HTTP 的 TLS、Origin、OAuth、scope、audience 和 Token 存储；
- Tool/Resource/Prompt 的实时列表、实际副作用和 Prompt Injection 防护效果。

## 8. 关键源码与规范索引

### 当前 `2026-07-28`

- [Host/Client/Server 架构](../servers/modelcontextprotocol/docs/specification/2026-07-28/architecture/index.mdx)
- [Core 与 request `_meta`](../servers/modelcontextprotocol/docs/specification/2026-07-28/basic/index.mdx)
- [版本与兼容策略](../servers/modelcontextprotocol/docs/specification/2026-07-28/basic/versioning.mdx)
- [`server/discover`](../servers/modelcontextprotocol/docs/specification/2026-07-28/server/discover.mdx)
- [Tools](../servers/modelcontextprotocol/docs/specification/2026-07-28/server/tools.mdx)
- [Resources](../servers/modelcontextprotocol/docs/specification/2026-07-28/server/resources.mdx)
- [Prompts](../servers/modelcontextprotocol/docs/specification/2026-07-28/server/prompts.mdx)
- [stdio](../servers/modelcontextprotocol/docs/specification/2026-07-28/basic/transports/stdio.mdx)
- [Streamable HTTP](../servers/modelcontextprotocol/docs/specification/2026-07-28/basic/transports/streamable-http.mdx)
- [Authorization security considerations](../servers/modelcontextprotocol/docs/specification/2026-07-28/basic/authorization/security-considerations.mdx)
- [TypeScript schema](../servers/modelcontextprotocol/schema/2026-07-28/schema.ts)

### 历史 `2025-11-25`

- [`initialize` 生命周期](../servers/modelcontextprotocol/docs/specification/2025-11-25/basic/lifecycle.mdx)
- [含 `InitializeRequest` / `InitializedNotification` 的 schema](../servers/modelcontextprotocol/schema/2025-11-25/schema.ts)

### 本仓库对照研究

- [OpenHands 与 MCP 集成](../../openhands-study/notes/09-mcp-integration.md)
- [Agent Reach Skill 与外部工具流](../../agent-reach-study/notes/03-skill-tool-flow.md)
- [Agent Reach 安全模型](../../agent-reach-study/notes/04-security-model.md)
- [REA 架构](../../rea-study/notes/03-architecture.md)

## 9. 阶段结论

MCP 的真实工作流不是“LLM 直接调用 Server”，而是：

```text
用户/应用策略
  → Host（上下文、授权、编排）
  → 每个 Server 对应一个 MCP Client
  → Transport 承载自包含 JSON-RPC 请求
  → Server 暴露并执行 Tool / Resource / Prompt
  → Client 返回标准结果
  → Host 转换为 UI、上下文、Event 或 Observation
  → Agent 决定下一步
```

当前协议把连接层做成可组合标准，但没有替 Host 完成 Agent loop，也没有替 Server 完成最小权限，更没有替用户判断调用是否值得信任。理解这一边界，是后续研究 MCP primitives、Authorization 和最小安全实验的前提。
