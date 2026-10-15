# 第一个最小 MCP Server 实验

> - 研究日期：2026-10-14
> - 实验目录：`mcp-study/servers/project-info-server`
> - 语言：TypeScript，ES Modules
> - SDK：`@modelcontextprotocol/server@2.3.1`、`@modelcontextprotocol/client@2.3.1`
> - 官方 SDK commit：`9bc40e903fde15534ec06ff4c1347d47000dbe16`
> - Tool：`get_project_info`
> - 当前状态：**源码和静态研究完成；依赖未安装，运行结果未验证**

## 0. 结论与执行边界

本阶段已经实现一个最小 TypeScript MCP Server，并配套创建了同进程 Client 实验。Server 只暴露一个只读 Tool：`get_project_info`，接收空对象并返回固定项目元数据。

官方 TypeScript SDK 不是 Node.js 内置模块。要真正执行实验，必须安装 `@modelcontextprotocol/server`、`@modelcontextprotocol/client`、`zod`、`tsx`、`typescript` 和 `@types/node`。依赖已经声明在 `package.json`，但根据“如需安装先说明，不自动执行”的要求，本阶段没有运行 `npm install`。

本文严格区分：

- 【已确认事实】：本地源码、官方 SDK 固定快照和静态检查可以证明；
- 【预期流程】：可由官方源码推导，但尚未实际运行；
- 【未验证】：必须安装依赖后才能确认。

## 1. 实验目标与限制

目标链路：

```text
McpServer
  → registerTool(get_project_info)
  → Client connect
  → tools/list
  → tools/call
  → CallToolResult
```

本阶段明确不做：

- 不连接真实账号；
- 不调用 Binance、GitHub 或其他外部 API；
- 不读取或修改项目文件；
- 不读取环境变量、Token、Cookie 或密钥；
- 不监听网络端口；
- 不修改官方 MCP submodule；
- 不安装依赖、不启动 stdio Server、不伪造运行输出。

## 2. Server 代码结构

```text
mcp-study/servers/project-info-server/
├─ package.json
├─ tsconfig.json
├─ README.md
└─ src/
   ├─ project-info-server.ts   # 固定数据、schema、Server factory、Tool handler
   ├─ server.ts                # stdio Server 入口，本阶段未启动
   └─ experiment.ts            # 同进程 Client/Server harness，本阶段未运行
```

| 文件 | 关键对象 | 职责 |
|---|---|---|
| `project-info-server.ts` | `PROJECT_INFO` | 固定返回数据，不访问外部数据源 |
| 同上 | `projectInfoSchema` | structured output 的 Zod schema |
| 同上 | `createProjectInfoServer()` | 创建 Server 并注册 Tool |
| `server.ts` | `serveStdio()` | 将 Server 暴露为 stdio 进程 |
| `experiment.ts` | `createMcpHandler()` | 在同进程提供 MCP handler |
| 同上 | `Client` | 执行连接、发现和调用 |
| 同上 | injected `fetch` | 直接调用 handler，不发真实网络请求 |

## 3. MCP Server 初始化流程

Server factory：

```ts
export function createProjectInfoServer(): McpServer {
  const server = new McpServer({
    name: 'project-info-study-server',
    version: '0.1.0'
  });

  // registerTool(...)
  return server;
}
```

### 【已确认事实：官方源码】

```text
McpServer.constructor()
  → new Server(serverInfo, options)
  → 初始化 Tool / Resource / Prompt registry
  → 保存 Server identity 与配置
```

构造对象时 Transport 尚未连接，也没有 Tool 被调用。

实验源码提供两个 serving 入口：

```text
server.ts
  → serveStdio(createProjectInfoServer)
  → SDK 管理 stdin/stdout

experiment.ts
  → createMcpHandler(createProjectInfoServer)
  → StreamableHTTPClientTransport + injected fetch
  → handler.fetch(...) 在同进程响应
```

第二种方式来自官方 SDK testing guide。`http://test.local/mcp` 只是构造 Request 所需的逻辑 URL；Transport 的 `fetch` 已替换为 `handler.fetch`，设计上不会经系统网络访问该地址。

## 4. Tool 注册流程

实验代码调用：

```text
server.registerTool(
  'get_project_info',
  config,
  async handler
)
```

### 【已确认事实：官方源码】

```text
registerTool(name, config, callback)
  → 检查同名 Tool
  → normalizeRawShapeSchema(inputSchema/outputSchema)
  → _createRegisteredTool(...)
  → validateAndWarnToolName(name)
  → 创建 RegisteredTool
  → 保存到 _registeredTools[name]
  → setToolRequestHandlers()
  → registerCapabilities({ tools: ... })
  → 安装 tools/list handler
  → 安装 tools/call handler
```

高层 `registerTool()` 同时完成 Tool registry、tools capability 和两类协议请求的绑定，不需要实验代码手写 JSON-RPC handler。

## 5. Tool schema 定义

### 输入 schema

`get_project_info` 不需要业务参数，但显式要求空对象：

```ts
inputSchema: z.object({})
```

SDK 将它转换为 `tools/list` 中的 JSON Schema，并在 handler 执行前验证 `tools/call.params.arguments`。

### 输出 schema

```ts
const projectInfoSchema = z.object({
  name: z.string(),
  module: z.string(),
  stage: z.number().int(),
  purpose: z.string(),
  dataSource: z.literal('fixed-local-data')
});
```

它既向 Client 广告 structured output 形状，也用于 Server 端结果验证。

### annotations

实验声明：

```text
readOnlyHint: true
destructiveHint: false
idempotentHint: true
openWorldHint: false
```

【已确认事实】这些字段只是提示。官方 schema 注释明确要求 Client 不应仅凭 annotations 做安全决策；它们不会自动建立文件、网络或进程沙箱。

## 6. Client 如何发现 Tool

实验 Client 显式启用 modern negotiation：

```text
new Client(
  { name: 'project-info-study-client', version: '0.1.0' },
  { versionNegotiation: { mode: 'auto' } }
)
```

### 【预期流程】连接与 capability 发现

```text
client.connect(transport)
  → server/discover probe
  → createMcpHandler 选择 modern serving path
  ← DiscoverResult（版本、capabilities、instructions）
  → Client 保存协议版本与 Server capabilities
```

这与 SDK 默认 legacy `initialize` 不同；`mode: 'auto'` 是显式选择。由于实验尚未运行，实际协商结果仍属于【未验证】。

Tool discovery 使用显式请求：

```ts
const listed = await client.listTools();
```

Client 得到 Tool definitions 后，Host 才能把名称、描述和 schema 提供给模型或人工界面。

## 7. `tools/list` 流程

### 【已确认事实：源码调用链】

```text
Client.listTools()
  → Protocol.request({ method: 'tools/list' })
  → StreamableHTTPClientTransport.send()
  → injected fetch(url, init)
  → handler.fetch(Request)
  → Server tools/list handler
  → 遍历 _registeredTools（注册顺序）
  → 过滤 disabled Tool
  → schema 转 JSON Schema
  → ListToolsResult
  → Client codec / schema validation
  → listed.tools
```

### 【预期发现结果】

`listed.tools` 应包含：

```text
name: get_project_info
title: Get project information
description: Return fixed metadata for the local AI-tools-lab MCP study.
inputSchema: empty object schema
outputSchema: project info object schema
annotations: read-only / non-destructive / idempotent / closed-world hints
```

这里没有伪造“实际捕获”的完整 JSON。不同协议 era 可能投影额外字段，必须以后通过真实运行确认。

## 8. `tools/call` 流程

实验调用：

```ts
await client.callTool({
  name: 'get_project_info',
  arguments: {}
});
```

### 【已确认事实：源码调用链】

```text
Client.callTool()
  → Protocol.request({ method: 'tools/call', params })
  → Transport / injected fetch
  → createMcpHandler
  → McpServer tools/call handler
  → _registeredTools['get_project_info']
  → validateToolInput(tool, {})
  → executeToolHandler(...)
  → validateToolOutput(...)
  → projectCallToolResult(...)
  → JSON-RPC Result
  → Client codec / schema validation
  → CallToolResult
```

官方 handler 会依次查找 Tool、验证输入、执行 handler、验证输出并投影结果。一般 handler/schema 错误会转换为 `isError: true` 的 Tool result；协议级错误仍是另一类错误面。

## 9. 返回结果格式

Tool handler 返回：

```ts
{
  content: [
    { type: 'text', text: JSON.stringify(PROJECT_INFO) }
  ],
  structuredContent: PROJECT_INFO
}
```

固定 JSON：

```json
{
  "name": "AI-tools-lab",
  "module": "mcp-study",
  "stage": 5,
  "purpose": "Understand a minimal MCP Server and Tool call flow",
  "dataSource": "fixed-local-data"
}
```

| 字段 | 用途 |
|---|---|
| `content[0].text` | 模型或人类可读的文本 content block |
| `structuredContent` | Host 可验证、可编程读取的 JSON |

【已确认事实】Server 与 Client 都可以根据 `outputSchema` 验证 structured output。

【未验证】没有捕获实际 wire bytes，也没有确认 modern wire 在该版本加入的内部 envelope 字段。本文只记录 handler 返回对象和 Client 公共 `CallToolResult`，不编造中间报文。

## 10. Client 实验断言

`experiment.ts` 设计了三个最小断言：

```text
tools/list 中必须存在 get_project_info
CallToolResult 不应标记 isError
structuredContent 必须深度等于 PROJECT_INFO
```

脚本还计划输出协议版本、protocol era、Server capabilities、Tool list 和 Call result。它们是待验证项，不是当前已有输出。

## 11. Evidence

### 官方源码 Evidence

| 证据 | 固定值/位置 |
|---|---|
| SDK commit | `9bc40e903fde15534ec06ff4c1347d47000dbe16` |
| Server package | `@modelcontextprotocol/server@2.3.1` |
| Client package | `@modelcontextprotocol/client@2.3.1` |
| Server registry | `packages/server/src/server/mcp.ts` |
| Client request path | `packages/client/src/client/client.ts` |
| Protocol request path | `packages/core-internal/src/shared/protocol.ts` |
| 官方同进程方法 | `docs/testing.md` |

### 本地实验文件 SHA-256

| 文件 | SHA-256 |
|---|---|
| `package.json` | `c5755498d10dcccc5824d09e9c216bb47edddeaf9cc1fe87599e122a688b3d98` |
| `tsconfig.json` | `459edae3f2d4dd51214ec45cda523cd6aa62c4788f98d1145b4759ecb157cf2b` |
| `src/project-info-server.ts` | `9c56296af0e2b8c6f3c52bc4d8411d0958e9d69a4362839642fc0f7dc35d1924` |
| `src/server.ts` | `8d80c0b3160be7f634b224cb11dde5dfcc77202156a26ad4954bc940dd568078` |
| `src/experiment.ts` | `b41716945b1f262d9dfaf9f86822610c752e548456c3bce86d425da84fa33459` |

这些摘要只固定写入笔记时的源码版本；以后修改代码必须重新计算。

### REA 静态分析尝试

目标是 TypeScript，因此对实验目录执行了已有 REA 源码版分析；没有安装依赖，也没有保存 raw output。

| 字段 | 结果 |
|---|---|
| exit code | `1` |
| 错误 | `capability_unavailable` / `unsupported_provider` |
| Evidence ID | `ev_cb2a03a9707e1953e2b62d8545718dea2559e58c87cf1c1912472a65fd529866` |
| Subject SHA-256 | `b580e30b9db32c8c74c1890f418e92144646ecb67f9a2e01618420bafe1b543b` |
| Inventory manifest | `agm_e319db7172570bc21040bfbfb646b30ef6ae24746287a579d5680a108a739ac0` |
| Inventory graph SHA-256 | `92f122bb999dd1ae097c8e1d0292550cb0090259016e1fa34312145527afc5d3` |
| relevant files / bytes | 5 / 3,758 |
| application graph | 11 nodes / 10 edges |
| semantic graph | 3 nodes / **0 relations** / 36 unknowns |
| parsed JavaScript files | `0` |

失败原因仍是当前 Windows REA 构建缺少 `native/windows/build/manifest.json`。因此调用链来自人工阅读本地代码和官方固定源码，不是 REA semantic graph。

### 静态语法检查

使用已存在的专用 Node.js `v24.18.0` 对三个 `.ts` 文件执行 `node --check`，退出码均为 `0`。这只确认 Node 能解析当前 TypeScript 语法，不会解析依赖类型，也不能代替 `tsc --noEmit` 或实际运行。

## 12. 安全边界

### 【已确认事实】

- Tool 返回编译进源码的常量；
- handler 没有网络、文件、子进程、数据库或环境变量访问；
- Client harness 的唯一 `fetch` 是显式注入的 `handler.fetch`；
- 没有 Token、Cookie、账号、Binance 或 GitHub 代码路径；
- package 标记为 `private: true`，降低误发布风险；
- stdio 入口存在，但本阶段没有启动；
- 官方 submodule 没有修改。

### 【合理推测风险】

- 未来 `npm install` 会访问 npm registry，并可能运行依赖安装脚本；
- Host 启动 `server.ts` 后，进程继承当前用户权限，MCP 不自动提供 OS 沙箱；
- Tool annotations 是提示，不是权限证明；
- 若以后把固定数据改成文件、网络或账号数据，本阶段的低风险结论失效；
- 若删除 injected `fetch`，HTTP Transport 就可能实际访问 URL。

### 【主观建议】

取得安装授权后，只在 `project-info-server` 目录安装，并按以下顺序验证：

```text
npm install
npm run typecheck
npm run experiment
```

先不运行 `npm run start`；同进程 harness 已能覆盖初始化、发现和调用，同时避免创建 stdio 子进程。

## 13. 当前结果

已完成：Server factory、固定数据 Tool、输入/输出 schema、stdio 入口、同进程 Client harness、调用链、Evidence 和安全边界。

未完成：依赖安装、typecheck、实际连接、实际 `tools/list`、实际 `tools/call`、实际输出和 exit code。

准确结论是：**实验实现已准备好，但运行验证因依赖尚未获准安装而暂停。**

## 参考路径

- [实验 README](../servers/project-info-server/README.md)
- [Server factory](../servers/project-info-server/src/project-info-server.ts)
- [stdio 入口](../servers/project-info-server/src/server.ts)
- [Client 实验](../servers/project-info-server/src/experiment.ts)
- [官方 first server guide](../clients/typescript-sdk/docs/get-started/first-server.md)
- [官方 Tools guide](../clients/typescript-sdk/docs/servers/tools.md)
- [官方 testing guide](../clients/typescript-sdk/docs/testing.md)
- [官方 McpServer 实现](../clients/typescript-sdk/packages/server/src/server/mcp.ts)
- [第四阶段 Client 研究](04-client-sdk.md)
