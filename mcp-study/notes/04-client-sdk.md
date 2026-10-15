# 官方 TypeScript SDK Client 源码研究

> - 研究日期：2026-10-14
> - 官方仓库：`modelcontextprotocol/typescript-sdk`
> - submodule 提交：`9bc40e903fde15534ec06ff4c1347d47000dbe16`
> - Client package：`@modelcontextprotocol/client@2.3.1`
> - 源码语言：TypeScript，ES Modules
> - 运行要求（仅来自 `package.json`）：Node.js `>=20`
> - 方法：REA 静态分析尝试 + 人工源码阅读
> - 未安装依赖、未构建、未启动 Server、未连接外部服务、未修改官方源码

## 0. 结论与前提修正

官方 TypeScript SDK v2 已把 Client 拆成独立的 `@modelcontextprotocol/client` package。它实现的是 **MCP 协议客户端与 Transport 层**：建立连接、协商协议、发送 JSON-RPC 请求、校验响应并返回 MCP 类型。它不包含 LLM 规划、Agent Action/Observation 循环或 Workspace 沙箱。

开始分析前必须修正三个容易混淆的前提：

1. **“SDK v2 实现 `2026-07-28`”不等于“默认连接使用 `2026-07-28`”。** 当前 `new Client(...).connect(...)` 默认仍走 2025-era 的 `initialize → notifications/initialized`。只有显式设置 `versionNegotiation: { mode: 'auto' }` 或 `{ pin: '2026-07-28' }` 才进入新一代 `server/discover` 协商。
2. **Transport 不决定 Agent 如何使用结果。** Transport 只负责把 JSON-RPC 消息送到 Server 并把响应交回协议层；把 `CallToolResult` 放进 LLM 上下文、记录为 Observation 或触发下一轮决策，是 Host/Agent 的职责。
3. **OpenHands 当前没有直接使用这里研究的 TypeScript Client 执行 MCP Tool。** OpenHands 的协议调用链在 Python SDK 中，基于 FastMCP；其 TypeScript `MCPClient` 是 Agent Server REST API 客户端。两者名称相同，职责不同。

## 1. 方法与证据边界

### 1.1 【源码确认事实】

研究对象固定为：

```text
D:\AI-tools-lab\mcp-study\clients\typescript-sdk
```

证据来源包括：

- `packages/client/src/client/client.ts`：Client、连接、能力检查、`listTools()`、`callTool()`；
- `packages/core-internal/src/shared/protocol.ts`：请求编号、JSON-RPC 分派、响应校验和超时；
- `packages/client/src/client/versionNegotiation.ts`：modern/legacy 协商；
- `packages/client/src/client/streamableHttp.ts`：Streamable HTTP；
- `packages/client/src/client/stdio.ts`：stdio 子进程 Transport；
- `packages/client/src/client/sse.ts`：旧 HTTP+SSE 兼容 Transport；
- `docs/clients/connect.md`、`docs/clients/calling.md`、`docs/protocol-versions.md` 和 migration guide。

### 1.2 【REA 实际输出】

目标 package 是 TypeScript，属于 REA JavaScript/TypeScript 静态分析范围。因此使用现有 REA 源码构建，对 `packages/client` 做了一次只读分析尝试：

| 项目 | 实际结果 |
|---|---|
| exit code | `1` |
| 错误 | `capability_unavailable` / `unsupported_provider` |
| Evidence ID | `ev_090aaaa20c5b1ed2ccf3a928ca73fdb8b112c6f942f3b9bc0949669b47602c76` |
| Subject SHA-256 | `ffae36c287a383b8e0790f896a863af36455769f31f5214297b031bdeb8f8241` |
| Inventory manifest | `agm_7ea38c8af2678a8a00ad802653d5be1310f256347e5cdf09a080ffc991a9b544` |
| Inventory graph SHA-256 | `cd9d68b6e378e58c99958870473625db5d92f38d57a6285512b3340abdeec231` |
| relevant files | `76` |
| text bytes read | `1,651,571` |
| application graph | 153 nodes / 152 edges |
| semantic graph | 73 nodes / **0 relations** / 876 unknowns |
| parsed JavaScript files | `0` |
| visited AST nodes | `0` |

失败原因仍是当前 Windows REA 源码构建缺少：

```text
native/windows/build/manifest.json
```

REA 本次可靠完成了文件级 inventory 和 Evidence 身份固定，但没有得到可用的函数调用关系。本文后续的 `Client → Protocol → Transport` 调用链均为**人工源码阅读**，不能标成 REA semantic relations。没有保存 raw output。

### 1.3 【未验证】

- 没有安装 pnpm/npm 依赖；
- 没有执行 build、typecheck、tests 或 conformance suite；
- 没有建立 Client/Server 连接；
- 没有验证 OAuth、网络重连、SSE 恢复或跨版本 fallback 的运行时表现；
- 没有验证 npm registry 中的 tarball 与本地 commit 字节一致。

## 2. MCP Client 项目结构

官方仓库是 pnpm workspace monorepo：

```text
typescript-sdk/
├─ packages/
│  ├─ client/                 # 本阶段主对象：Client、Transport、Auth、缓存
│  ├─ core/                   # 公开协议类型与 schema
│  ├─ core-internal/          # Protocol 基类、wire codec、内部错误与工具
│  ├─ server/                 # v2 Server API
│  ├─ server-legacy/          # legacy Server 兼容层
│  ├─ middleware/             # 中间件 package
│  └─ codemod/                # v1 → v2 迁移辅助
├─ docs/                      # Client/Server/版本/迁移文档
├─ examples/                  # 指南对应的可执行样例
├─ test/                      # e2e 与 conformance 相关测试
├─ package.json               # workspace 根脚本，Node >=20
└─ pnpm-workspace.yaml
```

Client package 内部：

```text
packages/client/
├─ src/
│  ├─ index.ts                # 浏览器/通用公共导出
│  ├─ stdio.ts                # Node/Bun/Deno 进程型 Transport 子路径导出
│  ├─ fromJsonSchema.ts       # schema 到运行时验证器适配
│  ├─ validators/             # AJV / Cloudflare Worker 验证器
│  └─ client/
│     ├─ client.ts            # Client 核心
│     ├─ versionNegotiation.ts# 协议 era 发现与 fallback
│     ├─ streamableHttp.ts    # Streamable HTTP Transport
│     ├─ stdio.ts             # stdio 子进程 Transport
│     ├─ sse.ts               # 旧 SSE Transport
│     ├─ responseCache.ts     # list 结果与 Tool definition 缓存
│     ├─ auth*.ts             # OAuth、认证扩展与错误
│     ├─ dpop.ts              # DPoP
│     └─ middleware.ts        # fetch/auth/logging 中间件
├─ test/client/               # Client、Transport、Auth、协商测试
├─ README.md
└─ package.json               # @modelcontextprotocol/client@2.3.1
```

### 关键分层

| 层 | 关键类/函数 | 职责 |
|---|---|---|
| 高层 Client API | `Client` | MCP 方法、Server 元数据、能力门控、分页、Tool 输出验证 |
| 协议核心 | `Protocol<ContextT>` | 请求 ID、pending handler、超时、JSON-RPC 分派、wire schema 校验 |
| 版本层 | `resolveVersionNegotiation()`、`negotiateEra()` | legacy/modern handshake 选择与 fallback |
| Transport | `StreamableHTTPClientTransport`、`StdioClientTransport`、`SSEClientTransport` | 字节/消息传输、生命周期、网络或子进程资源管理 |
| 类型/schema | `@modelcontextprotocol/core(-internal)` | 请求/结果类型、版本化 wire codec 和 runtime validation |

## 3. Client 创建流程

### 3.1 最小创建

公开入口从 `packages/client/src/index.ts` 导出 `Client` 和 HTTP/SSE Transport；stdio 因为依赖进程 API，从 `@modelcontextprotocol/client/stdio` 单独导出。

典型代码形状：

```ts
const client = new Client(
  { name: 'my-client', version: '1.0.0' },
  { capabilities: {}, versionNegotiation: { mode: 'auto' } }
);

const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3000/mcp')
);

await client.connect(transport);
```

本阶段没有执行该代码。

### 3.2 `Client` 构造器

路径：`packages/client/src/client/client.ts`

```text
new Client(clientInfo, options)
  → Protocol constructor
  → 保存 clientInfo
  → 复制 client capabilities
  → 选择 JSON Schema validator
  → 保存 strict capability / version negotiation 配置
  → 创建 response cache
  → 保存 list_changed 配置
```

`Client` 继承 `Protocol<ClientContext>`。构造阶段只建立本地状态，不发网络请求，也不自动启动任何 Server。

## 4. Transport 实现

### 4.1 Streamable HTTP

类：`StreamableHTTPClientTransport`

关键方法：

- `start()`：创建 Transport 生命周期 `AbortController`；本身不等于完成 MCP handshake；
- `send()` / `_send()`：构造 HTTP headers，以 POST 发送 JSON-RPC；
- `_handleSseStream()`：处理 `text/event-stream` 响应与恢复；
- `terminateSession()`：有 session ID 时用 HTTP DELETE 终止 Server session；
- `close()`：停止重连、abort 当前传输并触发 close 回调。

请求链：

```text
Protocol.request()
  → transport.send(JSON-RPC request)
  → HTTP POST /mcp
  → application/json 或 text/event-stream response
  → JSONRPCMessageSchema.parse(...)
  → transport.onmessage(...)
  → Protocol._onresponse(...)
```

Transport 管理 `MCP-Session-Id`、`MCP-Protocol-Version`、Accept/Content-Type、可选认证和 per-request abort。它不会决定调用哪个 Tool。

### 4.2 stdio

类：`StdioClientTransport`

关键方法：

- `start()`：用 `cross-spawn` 启动指定命令，`shell: false`，将 stdin/stdout 设为 pipe；
- `processReadBuffer()`：从 stdout 增量解析 JSON-RPC 消息并触发 `onmessage`；
- `send()`：序列化消息，写入子进程 stdin，处理 backpressure；
- `close()`：先关闭 stdin，等待后再尝试 `SIGTERM`、`SIGKILL`，最后清理 buffer。

【源码确认事实】stdio Transport **会启动本地子进程**。因此“只创建 Transport 配置”与“调用 `client.connect()`”的安全边界不同：后者会触发 `start()`，实际执行 `command`。

### 4.3 SSE compatibility

`SSEClientTransport` 服务于早于 Streamable HTTP 的旧 Server。官方 Client guide 建议先尝试 Streamable HTTP，失败后用一个新的 Client 实例连接 SSE。它是兼容路径，不是当前首选 Transport。

### 4.4 In-memory

`InMemoryTransport.createLinkedPair()` 可在同一进程连接 Client 与 Server，适合测试。它没有网络和子进程，但仍会执行所连接 Server 的 handler，不能因为“in-memory”就推断为无副作用。

## 5. Server 连接与 capability 协商

### 5.1 `Protocol.connect()` 的公共底座

路径：`packages/core-internal/src/shared/protocol.ts`

```text
Protocol.connect(transport)
  → 保存 transport
  → 接管 onclose / onerror / onmessage
  → 把支持的协议版本交给 transport
  → transport.start()
```

收到消息后，`onmessage` 按 JSON-RPC 类型分派：

```text
Result / Error Response → _onresponse()
Request                 → _onrequest()
Notification            → _onnotification()
```

### 5.2 默认 legacy handshake

【源码确认事实】没有配置 `versionNegotiation` 时，`Client.connect()` 进入 `_connectPlainLegacy()`：

```text
Client.connect(transport)
  → resolveVersionNegotiation() = legacy
  → Protocol.connect(transport)
  → Client._legacyHandshake()
  → request('initialize', {
       protocolVersion,
       capabilities: clientCapabilities,
       clientInfo
     })
  ← InitializeResult {
       protocolVersion,
       capabilities: serverCapabilities,
       serverInfo,
       instructions?
     }
  → transport.setProtocolVersion(...)
  → notification('notifications/initialized')
  → 保存 negotiated version
```

这里 capability 协商是双向声明：Client 在 `initialize` 中声明自身能力，Server 返回 Server capabilities。后续 Client 方法根据 Server 声明判断相应能力是否存在。

### 5.3 显式 modern negotiation

`versionNegotiation` 有三种核心模式：

| 配置 | 行为 |
|---|---|
| 缺省或 `{ mode: 'legacy' }` | 直接运行 2025-era `initialize`，不探测 |
| `{ mode: 'auto' }` | 先 `server/discover`，识别 modern 后使用新 era；识别为旧 Server 时可 fallback 到 `initialize` |
| `{ mode: { pin: '2026-07-28' } }` | 只接受指定 modern revision；不 fallback |

modern probe 在 `_meta` envelope 中携带：

```text
protocolVersion
clientInfo
clientCapabilities
```

Server 的 `DiscoverResult` 提供支持版本、capabilities、instructions 等信息。Client 保存后可通过：

- `getServerCapabilities()`；
- `getServerVersion()`；
- `getInstructions()`；
- `getNegotiatedProtocolVersion()`；
- `getProtocolEra()`；
- `getDiscoverResult()`

读取连接结果。

### 5.4 capability 如何约束调用

`Client.assertCapabilityForMethod()` 将：

- `tools/list`、`tools/call` 对应 `serverCapabilities.tools`；
- prompt 方法对应 `serverCapabilities.prompts`；
- resource 方法对应 `serverCapabilities.resources`；
- completion 对应 `serverCapabilities.completions`。

需要注意一个实现细节：底层 `Protocol` 只有在 `enforceStrictCapabilities: true` 时对所有 `request()` 强制调用该检查；高层 `listTools()` 在非 strict 模式下发现 Server 未声明 tools，会返回 `{ tools: [] }`。因此“capability 是声明边界”成立，但具体错误/空结果行为受 Client 配置和高层方法控制。

## 6. `tools/list` 请求流程

入口：`Client.listTools(params?, options?)`

### 无显式 cursor

```text
client.listTools()
  → 检查 serverCapabilities.tools
  → 查询 response cache
  → _listAllPages('tools/list', ...)
  → 每页 Protocol.request({ method: 'tools/list' })
  → 自动跟随 nextCursor
  → 聚合 Tool[]
  → modern HTTP：过滤非法 x-mcp-header 声明
  → 写入 response cache
  → 返回 { tools }
```

默认最多聚合 64 页；`listMaxPages: 0` 可取消这一上限。

### 显式 cursor

```text
client.listTools({ cursor })
  → 只请求该页
  → 返回 Server 的 page 与 nextCursor
  → 不写 aggregate cache
```

缓存中的 Tool definition 还会被 `callTool()` 用于：

- 编译 `outputSchema` validator；
- modern HTTP 的 `x-mcp-header → Mcp-Param-*` 镜像。

因此 `tools/list` 不只是给 UI 显示名称，它也为后续调用的结果验证和部分 HTTP 约束提供 schema 上下文。

## 7. `tools/call` 请求流程

入口：`Client.callTool(params, options?)`

```text
client.callTool({ name, arguments })
  → 从显式 toolDefinition 或缓存读取 Tool schema
  → 如有 outputSchema，预编译 validator
  → modern HTTP：按 x-mcp-header 构造额外 headers
  → Protocol.request({ method: 'tools/call', params })
  → 分配 JSON-RPC id
  → 注册 response handler / timeout / progress handler
  → Transport.send(request)
  ← Server JSON-RPC Result 或 Error
  → Protocol._onresponse() 按 id 找到 pending handler
  → wire codec decodeResult()
  → method 对应 result schema validation
  → Client 对 structuredContent 做 outputSchema validation
  → 返回 CallToolResult
```

### 两种错误面

| 类型 | SDK 行为 |
|---|---|
| Tool 已执行但报告业务失败 | 返回 `CallToolResult`，通常 `isError: true` |
| JSON-RPC、超时、能力、schema 或连接失败 | 抛出 `ProtocolError` / `SdkError` 等异常 |

调用方不能只靠 `try/catch` 判断 Tool 成败，还必须检查 `result.isError`。

### `HEADER_MISMATCH` 恢复

modern HTTP 下，如果 Server 因 `Mcp-Param-*` 不匹配拒绝调用，Client 会在适用条件下：

```text
清除 tools/list cache
  → 强制重新 listTools()
  → 用新 Tool definition 重建 headers/validator
  → 重试一次 tools/call
```

这不是通用的业务失败自动重试，而是针对新协议 header/schema 漂移的单次恢复路径。

## 8. 返回结果如何转换

### 8.1 Transport 层

Transport 将 HTTP body、SSE event 或 stdio line 解析为 JSON-RPC message，并触发 `onmessage`。它不理解“Observation”。

### 8.2 Protocol 层

`Protocol._onresponse()`：

1. 用 response `id` 找到 pending handler；
2. 清理 timeout 和 progress handler；
3. JSON-RPC error 转成 `ProtocolError`；
4. result 交给当前协议 era 的 wire codec；
5. 用 method 对应 schema 做 runtime validation；
6. resolve 为 TypeScript 类型化结果。

### 8.3 Client 层

`callTool()` 最终返回 `CallToolResult`，主要内容包括：

- `content`：给模型/用户消费的 content blocks；
- `structuredContent`：可选的机器可读 JSON 值；
- `isError`：Tool 级错误标志；
- 其他协议允许的 metadata。

如果之前的 Tool definition 声明了 `outputSchema`，Client 会验证 `structuredContent`。非错误结果缺少必需的 structured output，或内容不符合 schema，会转为协议级异常。

### 8.4 【合理推测】Host 的下一步

SDK 返回后，Host 通常会把 `content` 转成模型可见上下文，把 structured output 交给业务逻辑，并决定是否继续 Agent 循环。这里是合理的宿主设计模式，不是 `@modelcontextprotocol/client` 自动执行的行为。

## 9. MCP Client 与 OpenHands MCP Tool 集成的区别

### 9.1 两条链路

官方 TypeScript SDK：

```text
Client.callTool()
  → JSON-RPC tools/call
  → Transport
  → MCP Server
  → CallToolResult
```

OpenHands：

```text
LLM Tool Call
  → MCPToolDefinition.action_from_arguments()
  → MCPToolAction
  → ActionEvent
  → MCPToolExecutor
  → Python MCPClient / FastMCP call_tool_mcp()
  → MCP Server
  → CallToolResult
  → MCPToolObservation.from_call_tool_result()
  → ObservationEvent
  → Conversation state / 下一轮 LLM 输入
```

### 9.2 职责对比

| 维度 | 官方 TypeScript SDK Client | OpenHands MCP 集成 |
|---|---|---|
| 层级 | 协议与连接层 | Agent Tool 适配与执行层 |
| 核心对象 | `Client`、`Protocol`、`Transport` | `MCPToolDefinition`、`MCPToolAction`、`MCPToolExecutor`、`MCPToolObservation` |
| Tool 发现 | `client.listTools()` 返回 MCP Tool definitions | `create_mcp_tools()` 发现后转换并注册为 OpenHands runtime tools |
| Tool 选择 | 不选择；调用者传入 name/arguments | LLM 根据暴露的 Tool schema 选择 |
| 调用 | 构造并发送 `tools/call` | executor 调协议 Client，再映射为 Agent 事件 |
| 返回 | `CallToolResult` | `MCPToolObservation` → `ObservationEvent` |
| 状态 | 连接状态、请求状态、缓存、协议版本 | Conversation state、事件历史、Agent loop 状态 |
| LLM | 不内置 | Agent loop 中使用 LLM |
| 权限/沙箱 | 协议 Client 不提供通用执行沙箱 | OpenHands Runtime、secret registry、用户策略共同承担边界 |
| 当前实现语言 | 本文对象为 TypeScript | MCP 协议调用链主要为 Python/FastMCP |

### 9.3 核心差异

`CallToolResult` 与 `ObservationEvent` 不是同一层的对象：

```text
MCP Result
  = 跨 Client/Server 边界的协议返回

OpenHands ObservationEvent
  = Agent 内部可持久化、可进入状态与下一轮决策的执行观察
```

因此题目中的两条简化链路都合理，但 OpenHands 链路中间实际还包含协议 Client；官方 TypeScript SDK 链路末尾也不自动进入 Agent 上下文。二者不是竞争实现，而是可上下叠加的两个抽象层。

## 10. 关键文件、类与函数索引

| 文件 | 类/函数 | 作用 |
|---|---|---|
| `packages/client/src/index.ts` | public exports | 通用 Client API 出口 |
| `packages/client/src/stdio.ts` | stdio subpath exports | 隔离 Node 进程依赖 |
| `packages/client/src/client/client.ts` | `Client` | 高层 Client、协商状态、MCP 方法 |
| 同上 | `connect()` | 选择 prior/legacy/negotiated 连接路径 |
| 同上 | `_legacyHandshake()` | `initialize → initialized` |
| 同上 | `listTools()` | 能力门控、分页聚合与缓存 |
| 同上 | `callTool()` | Tool 调用、headers、output schema 验证 |
| `packages/core-internal/src/shared/protocol.ts` | `Protocol` | JSON-RPC request/response 生命周期 |
| 同上 | `connect()` | 绑定 Transport callbacks 并启动 Transport |
| 同上 | `request()` / `_requestWithSchemaViaCodec()` | 编号、发送、超时、codec 与 schema validation |
| 同上 | `_onresponse()` | 按 id 完成 pending request |
| `packages/client/src/client/versionNegotiation.ts` | `buildProbeRequest()` | 构造 modern `server/discover` 请求 |
| 同上 | `negotiateEra()` | modern 探测、版本选择、legacy fallback |
| `packages/client/src/client/streamableHttp.ts` | `StreamableHTTPClientTransport` | HTTP POST、SSE response、session/auth |
| `packages/client/src/client/stdio.ts` | `StdioClientTransport` | 启动子进程并通过 stdin/stdout 传输 |
| `packages/client/src/client/sse.ts` | `SSEClientTransport` | 兼容旧 SSE Server |
| `packages/client/src/client/responseCache.ts` | `ClientResponseCache` | 列表、Tool definition 和 validator 缓存 |

## 11. 安全边界与风险提示

### 【源码确认事实】

- 调用 `StdioClientTransport.start()` 会执行配置的本地命令；
- Streamable HTTP Transport 会向给定 URL 发送 Client/Tool 数据；
- Server capabilities、Tool schema、instructions 和 Tool result 都来自远端 Server；
- SDK 负责协议 validation 和部分 OAuth/redirect/header 防护，但不是通用权限沙箱；
- `getServerVersion()` 等身份信息是 Server 自报信息，不应独立用于安全决策。

### 【合理推测】

- 恶意 Server 可以通过 Tool 描述、instructions 或返回文本影响 Host 的 LLM，因此 Host 仍需做来源信任、数据最小化、用户确认和内容隔离；
- 自动把所有 `listTools()` 结果暴露给模型会扩大权限面，应由 Host 做 allowlist、风险分级和按任务授权；
- stdio Server 与 Client 运行在相同宿主权限下时，MCP 协议本身不能限制其本地文件或网络权限。

### 【主观建议】

后续实验优先使用：

1. 官方 in-memory 测试示例或仅能访问临时目录的 stdio Server；
2. 明确 Tool allowlist；
3. 无 Token、无 Cookie、无真实账号；
4. 先 `tools/list` 人工审查，再允许单次只读 `tools/call`；
5. 将 MCP 原始 Result 与 Host 生成的 Observation 分开记录。

## 12. 本阶段结论

官方 TypeScript SDK Client 的核心不是“让 LLM 自动使用 Tool”，而是提供一条类型化、版本化、可验证的协议通道：

```text
应用代码
  → Client 高层方法
  → Protocol JSON-RPC 生命周期
  → Transport
  → Server
  → wire codec / schema validation
  → MCP typed result
```

OpenHands 再在这类协议通道之上增加 Agent 所需的 ToolDefinition、ActionEvent、Executor、ObservationEvent、Conversation state 和下一轮 LLM 决策。理解这一分层，可以避免把 MCP SDK 误认为 Agent 框架，也避免把 OpenHands 的 Observation 模型误认为 MCP 协议规定。

本阶段只证明了固定源码快照中的静态结构和人工追踪调用链。REA 因 Windows native manifest 缺失未生成 semantic relations；运行时连接、跨版本互操作和安全行为仍未验证。

## 参考路径

- [官方 TypeScript SDK README](../clients/typescript-sdk/README.md)
- [Client package README](../clients/typescript-sdk/packages/client/README.md)
- [Client 核心](../clients/typescript-sdk/packages/client/src/client/client.ts)
- [Protocol 核心](../clients/typescript-sdk/packages/core-internal/src/shared/protocol.ts)
- [版本协商](../clients/typescript-sdk/packages/client/src/client/versionNegotiation.ts)
- [Streamable HTTP Transport](../clients/typescript-sdk/packages/client/src/client/streamableHttp.ts)
- [stdio Transport](../clients/typescript-sdk/packages/client/src/client/stdio.ts)
- [Client 连接指南](../clients/typescript-sdk/docs/clients/connect.md)
- [Tool 调用指南](../clients/typescript-sdk/docs/clients/calling.md)
- [Protocol versions](../clients/typescript-sdk/docs/protocol-versions.md)
- [OpenHands MCP 集成研究](../../openhands-study/notes/09-mcp-integration.md)
