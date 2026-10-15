# 第一个自建 MCP Server 运行结果

> - 实验日期：2026-10-14
> - 实验目录：`mcp-study/servers/project-info-server`
> - 实验对象：MCP Client ↔ MCP Server 协议层
> - Tool：`get_project_info`
> - 结果：**成功**
> - 未启动 OpenHands，未把本实验描述成 OpenHands 调用

## 0. 结论

本次真实验证链路成功：

```text
TypeScript MCP Client
  → server/discover
  → TypeScript MCP Server
  → tools/list
  → 发现 get_project_info
  → tools/call
  → CallToolResult
```

三个要求步骤的退出码均为 `0`：

| 步骤 | 命令 | exit code |
|---|---|---|
| 安装依赖 | `npm install` | `0` |
| 类型检查 | `npm run typecheck` | `0` |
| 协议实验 | `npm run experiment` | `0` |

为补足 `server/discover` 和逻辑请求对象 Evidence，随后又执行了一次等价的同进程 Client/Server 连接；Evidence run 退出码同样为 `0`。没有修改实验源码。

## 1. 实验环境

### Runtime

| 项目 | 实际版本 |
|---|---|
| 操作系统 | Windows |
| Node.js | `v24.18.0` |
| npm | `11.16.0` |
| package lock format | `lockfileVersion: 3` |

本次使用：

```text
D:\tools\node-v24.18.0-win-x64
```

只在执行进程内临时把该目录放到 PATH 前部，没有修改系统 PATH。系统原有 `D:\nodejs` 没有被覆盖。

### 安装后的顶层依赖

`npm ls --depth=0` 退出码为 `0`：

| package | 实际安装版本 |
|---|---|
| `@modelcontextprotocol/client` | `2.3.1` |
| `@modelcontextprotocol/server` | `2.3.1` |
| `zod` | `4.6.7` |
| `tsx` | `4.23.15` |
| `typescript` | `5.9.3` |
| `@types/node` | `24.19.2` |

`package.json` 对 MCP Client/Server 使用固定版本 `2.3.1`；其他依赖采用兼容范围，所以实际安装版本可能高于最初声明的最低版本。

### 安装警告

`npm install` 安装 20 个 package，并报告：

```text
allow-scripts: esbuild@0.28.2 的 postinstall 未获批准
```

没有执行额外的 `npm approve-scripts`。虽然出现该警告，`tsx` 实验、TypeScript 检查和两个 MCP 运行均成功，因此它没有阻塞本次实验。不能据此推断所有依赖脚本场景都不会受影响。

## 2. Client 如何启动并连接 Server

### 实际启动

```text
npm run experiment
  → tsx src/experiment.ts
```

这不是两个独立生产进程，也没有启动 OpenHands。实验采用官方 testing guide 的同进程方式：

```text
createProjectInfoServer()
  → createMcpHandler(factory)
  → StreamableHTTPClientTransport(
       URL('http://test.local/mcp'),
       { fetch: handler.fetch }
     )
  → Client.connect(transport)
```

Transport 使用注入的 `fetch`，所有 Request 直接交给本进程 `handler.fetch()`。`http://test.local/mcp` 只是 Request 的逻辑 URL，本实验没有打开监听端口。

### 实际协议协商

Client 配置：

```text
versionNegotiation: { mode: 'auto' }
```

实际结果：

```text
protocolVersion: 2026-07-28
protocolEra: modern
```

因此本次不是 SDK 默认的 legacy `initialize`，而是通过 `server/discover` 完成 modern era 协商。

## 3. MCP Evidence

### 3.1 `server/discover` 结果

以下是 `client.getDiscoverResult()` 的实际结果：

```json
{
  "_meta": {
    "io.modelcontextprotocol/serverInfo": {
      "name": "project-info-study-server",
      "version": "0.1.0"
    }
  },
  "ttlMs": 0,
  "cacheScope": "private",
  "supportedVersions": [
    "2026-07-28"
  ],
  "capabilities": {
    "tools": {
      "listChanged": true
    }
  },
  "resultType": "complete"
}
```

【已确认事实】Server 声明了 tools capability，并协商到 `2026-07-28`。`ttlMs: 0` 和 `cacheScope: private` 表示该 discover result 没有可复用缓存寿命，且缓存范围为私有。

## 4. Tool 发现与 `tools/list`

### 4.1 逻辑请求

```json
{
  "method": "tools/list",
  "params": {}
}
```

这是 Client API 发起的逻辑 MCP 请求；本实验没有保存包含 JSON-RPC id、HTTP headers 和 `_meta` envelope 的 raw wire capture。

### 4.2 实际发现结果

返回了一个 Tool：

```text
get_project_info
```

实际 Tool metadata：

```json
{
  "name": "get_project_info",
  "title": "Get project information",
  "description": "Return fixed metadata for the local AI-tools-lab MCP study.",
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": false
  }
}
```

### 4.3 实际 input schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {}
}
```

这与 Tool 接受空参数对象的设计一致。

### 4.4 实际 output schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "module": { "type": "string" },
    "stage": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "purpose": { "type": "string" },
    "dataSource": {
      "type": "string",
      "const": "fixed-local-data"
    }
  },
  "required": [
    "name",
    "module",
    "stage",
    "purpose",
    "dataSource"
  ],
  "additionalProperties": false
}
```

这证明 Zod output schema 已被 Server 转换为 Client 可发现的 JSON Schema。

## 5. `tools/call` 与 CallToolResult

### 5.1 逻辑请求

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_project_info",
    "arguments": {}
  }
}
```

同样，这记录的是实际 Client 调用对应的逻辑请求，不是 raw wire dump。

### 5.2 实际 CallToolResult

```json
{
  "_meta": {
    "io.modelcontextprotocol/serverInfo": {
      "name": "project-info-study-server",
      "version": "0.1.0"
    }
  },
  "content": [
    {
      "type": "text",
      "text": "{\"name\":\"AI-tools-lab\",\"module\":\"mcp-study\",\"stage\":5,\"purpose\":\"Understand a minimal MCP Server and Tool call flow\",\"dataSource\":\"fixed-local-data\"}"
    }
  ],
  "structuredContent": {
    "name": "AI-tools-lab",
    "module": "mcp-study",
    "stage": 5,
    "purpose": "Understand a minimal MCP Server and Tool call flow",
    "dataSource": "fixed-local-data"
  }
}
```

实验断言全部通过：

- `tools/list` 中存在 `get_project_info`；
- `result.isError !== true`；
- `structuredContent` 与源码固定的 `PROJECT_INFO` 深度相等。

`content` 是模型/人类可读文本；`structuredContent` 是 Host 可直接读取的结构化结果。

## 6. 实际调用链

```text
npm run experiment
  → Client.connect()
  → StreamableHTTPClientTransport
  → injected handler.fetch
  → createMcpHandler
  → server/discover
  ← DiscoverResult（2026-07-28, tools capability）

Client.listTools()
  → tools/list
  → McpServer registered Tool registry
  ← get_project_info + input/output schema

Client.callTool({ name: 'get_project_info', arguments: {} })
  → tools/call
  → input validation
  → Tool handler
  → output validation
  ← CallToolResult
```

该链路只验证 MCP 协议与 SDK 实现，没有 LLM、Agent planning、ActionEvent 或 ObservationEvent。

## 7. 安全边界检查

### 【源码确认事实】

- Tool handler 只返回 `PROJECT_INFO` 常量；
- Tool 源码没有导入或调用文件系统 API；
- 没有 `process.env` 或其他环境变量读取；
- 没有账号、Token、Cookie、Binance 或 GitHub 调用；
- 没有数据库或子进程调用；
- runtime Client 使用注入的 `handler.fetch`，没有创建网络监听端口；
- 没有运行 `src/server.ts` 的 stdio 入口；
- 官方 MCP submodule 没有修改。

### 【需要限定的确认】

- `npm install` 按明确授权访问了 npm registry；“不访问外部服务”只适用于 MCP runtime 实验，不包括必需的依赖下载。
- 没有做 OS 级网络抓包。runtime 无外部访问的判断来自实际连接方式和源码路径，而不是网络层抓包证明。
- annotations 仍只是提示，不是权限沙箱。

## 8. 未来如何接入 OpenHands

本次 `createMcpHandler + injected fetch` 是同进程测试 harness，OpenHands Python MCP Client 不能直接持有这个 JavaScript 内存对象。

未来接入有两种协议边界：

1. **stdio**：OpenHands/FastMCP 启动 `src/server.ts` 对应的本地命令，通过 stdin/stdout 发现并调用 Tool；
2. **Streamable HTTP**：把同一个 Server factory 部署为受控 HTTP endpoint，OpenHands 通过 URL 连接。

以当前 stdio 入口为例，未来链路应是：

```text
用户请求
  ↓
OpenHands Agent / LLM
  ↓
MCPToolDefinition
  ↓
ActionEvent
  ↓
OpenHands Python MCP Client（FastMCP）
  ↓ stdio
project-info-study-server
  ↓
get_project_info
  ↓
CallToolResult
  ↓
MCPToolObservation
  ↓
ObservationEvent
```

【已确认事实】当前 Server 已能通过 MCP `tools/list` 广告 Tool，并通过 `tools/call` 返回符合 schema 的结果。

【未验证】本阶段没有安装或启动 OpenHands，没有创建 OpenHands MCP 配置，也没有验证 FastMCP 与该 stdio 入口的互操作。那应是独立的后续实验，不能用本次 TypeScript Client 结果替代。

## 9. 文件与产物状态

`npm install` 在实验目录生成：

- `node_modules/`：依赖目录，已被 `mcp-study/.gitignore` 忽略；
- `package-lock.json`：项目级可复现依赖锁文件，当前未提交。

没有生成：

- raw output 文件；
- 实验缓存目录；
- `dist/`、`build/` 或 coverage；
- Token、Cookie 或账号配置。

## 10. 最终判定

```text
安装：PASS
类型检查：PASS
MCP modern negotiation：PASS
tools/list：PASS
get_project_info discovery：PASS
tools/call：PASS
CallToolResult schema/assertion：PASS
外部业务服务调用：NONE
OpenHands integration：NOT TESTED
```

本次证明的是：**自建 `project-info-server` 已能被真实的官方 TypeScript MCP Client 发现和调用。** 它没有证明 OpenHands 已经接入，也没有扩大 Tool 的数据或权限范围。

## 参考路径

- [Server factory](../servers/project-info-server/src/project-info-server.ts)
- [Client experiment](../servers/project-info-server/src/experiment.ts)
- [实验 package](../servers/project-info-server/package.json)
- [第五阶段设计与静态研究](05-first-server.md)
- [官方 TypeScript Client 研究](04-client-sdk.md)
