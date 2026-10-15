# OpenHands 调用自建 MCP Server：集成研究与验证门禁

> - 研究日期：2026-10-14
> - 自建 Server：`mcp-study/servers/project-info-server`
> - Tool：`get_project_info`
> - OpenHands 主仓库快照：`2bdc0e9d6c5940bc3d4667fb2127fbb753b2f7c8`
> - Software Agent SDK 快照：`7bd668c9ab74f62c85745cd95adb503f53e7228b`
> - 本阶段结果：**源码调用链已确认；OpenHands 运行时集成尚未执行**

## 0. 结论与前提纠正

第五阶段已经证明：官方 TypeScript MCP Client 能发现并调用本地
`get_project_info`。这只能证明 MCP 协议层可用，**不能证明 OpenHands Agent 已经调用过该 Tool**。

本阶段静态源码确认 OpenHands 具备所需适配链：

```text
Agent.mcp_config
  → LocalConversation 初始化
  → Python MCPClient（继承 fastmcp.Client）
  → tools/list
  → MCPToolDefinition
  → Agent.tools_map
  → LLM / TestLLM 选择 get_project_info
  → ActionEvent(MCPToolAction)
  → MCPToolExecutor
  → FastMCP call_tool_mcp()
  → project-info-server
  → CallToolResult
  → MCPToolObservation
  → ObservationEvent
  → 下一轮 Agent 上下文
```

但是当前机器没有可导入的 `openhands` 或 `fastmcp`，默认 Python 又不满足仓库要求。根据“不自动安装依赖”的约束，本阶段没有启动 OpenHands、没有启动自建 stdio Server，也没有伪造 Agent 运行结果。

最终判定：

```text
第五阶段 MCP 协议实验：VERIFIED / PASS
OpenHands 源码集成能力：SOURCE-CONFIRMED
OpenHands → project-info-server 真实调用：NOT RUN / NOT VERIFIED
```

## 1. 执行前环境门禁

### 1.1 实际检查结果

| 检查项 | 当前结果 | 判断 |
|---|---|---|
| 默认 Python | `D:\python310\python.exe`，`3.10.11` | 不满足 SDK 的 `>=3.12` |
| 另一套 Python | `D:\python314\python.exe`，`3.14.6` | 版本范围表面满足，但兼容性未验证 |
| `uv` | `0.12.16` | 可用，但本阶段未让它创建环境或下载依赖 |
| OpenHands 虚拟环境 | `openhands-study/software-agent-sdk/.venv` 不存在 | 未准备 |
| `openhands` import | Python 3.10 与 3.14 均不可用 | 缺少依赖 |
| `fastmcp` import | Python 3.10 与 3.14 均不可用 | 缺少依赖 |
| SDK Python 要求 | `>=3.12` | 来自 `openhands-sdk/pyproject.toml` 与 `uv.lock` |
| SDK FastMCP 约束 | `fastmcp>=3.2.0,<4` | 锁文件固定为 `3.2.0` |
| Python MCP SDK | 锁文件固定为 `mcp==1.28.1` | 尚未安装 |
| 专用 Node | `v24.18.0` | 可用 |
| 专用 npm | `11.16.0` | 可用 |
| Server `node_modules` | 已存在 | 来自第五阶段已授权安装 |
| `tsx` CLI | 已存在 | 可由专用 Node 直接启动 |

### 1.2 为什么停止运行验证

要验证 Agent Layer，至少需要导入当前 Software Agent SDK、FastMCP 和它们的锁定依赖。当前环境不满足这一条件。执行 `uv sync`、创建虚拟环境或安装 editable package 都属于新增依赖安装，必须先取得明确授权。

另外，Python 3.14.6 虽然高于最低版本 3.12，但“高于最低版本”不等于整套锁定依赖已经支持 3.14；不能把它直接标记为安全可用。后续优先使用仓库支持范围内、依赖兼容性更成熟的 Python 3.12 或 3.13 独立环境。

## 2. OpenHands MCP 配置方式

### 【源码确认事实】

`AgentBase.mcp_config` 的内部类型是：

```python
dict[str, MCPServer]
```

每个 `MCPServer` 可描述：

- `transport`；
- `command`、`args`、`cwd`、`env`；
- 或远端 `url`、`headers`、`auth`；
- `timeout`、`enabled` 等状态。

stdio Server 必须提供 `command`。内部配置是扁平 Server map，不是 FastMCP 配置文件常见的整个 `{"mcpServers": {...}}` 包装。`to_fastmcp_mcp_config()` 只在 SDK 内部连接边界加上该包装。

关键源码：

- `openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/agent/base.py`
  - `AgentBase.mcp_config`
- `.../openhands/sdk/mcp/config.py`
  - `MCPServer`
  - `coerce_mcp_config()`
  - `enabled_mcp_servers()`
  - `to_fastmcp_mcp_config()`

### 本实验的建议配置（未执行）

为了不修改系统 PATH，也避免依赖系统 npm 解析，后续验证应直接调用专用 `node.exe`：

```python
from openhands.sdk.mcp.config import MCPServer

mcp_config = {
    "project-info": MCPServer(
        transport="stdio",
        command=r"D:\tools\node-v24.18.0-win-x64\node.exe",
        args=[
            r"D:\AI-tools-lab\mcp-study\servers\project-info-server\node_modules\tsx\dist\cli.mjs",
            "src/server.ts",
        ],
        cwd=r"D:\AI-tools-lab\mcp-study\servers\project-info-server",
        env={},
        enabled=True,
    )
}
```

这是基于配置模型和现有文件路径形成的**待验证配置**，不是本阶段运行成功记录。

## 3. MCP Server 如何注册到 OpenHands

### 【源码确认事实】

`LocalConversation._ensure_agent_ready()` 是主要运行时入口：

```text
LocalConversation._ensure_agent_ready()
  → _ensure_plugins_loaded()
  → agent._initialize(state)
  → _runtime_mcp_tools_for_agent()
  → _runtime_mcp_tools(agent.mcp_config)
  → DefaultMCPToolProvider.create_tools()
  → create_mcp_tools()
  → agent.add_runtime_tools(runtime_mcp_tools)
```

相关类/函数：

| 文件 | 类/函数 | 作用 |
|---|---|---|
| `.../conversation/impl/local_conversation.py` | `_ensure_agent_ready()` | 初始化 Agent，并注册运行时 MCP Tools |
| 同上 | `_runtime_mcp_tools_for_agent()` | 读取 `agent.mcp_config` |
| 同上 | `_runtime_mcp_tools()` | 调用 Provider 建立 MCP Client；失败时返回空 Tool 列表 |
| `.../mcp/utils.py` | `DefaultMCPToolProvider.create_tools()` | 委托给 `create_mcp_tools()` |
| `.../agent/base.py` | `add_runtime_tools()` | 把发现到的 Tool 放入 `tools_map` |

只有 `enabled=True` 的 Server 会被连接。若 Server 启动或发现失败，`_runtime_mcp_tools()` 会记录警告并让会话在没有该 Tool 的情况下继续；因此只观察到 Agent 启动成功，不能反推 MCP Tool 已注册成功。

## 4. `MCPToolDefinition` 如何生成

### 4.1 Discovery 与转换

```text
create_mcp_tools(mcp_config)
  → _prepare_mcp_config()
  → FastMCPConfig.model_validate(...)
  → MCPClient(config)
  → MCPClient.connect()
  → client.list_tools()
  → list[mcp.types.Tool]
  → MCPToolDefinition.create(mcp_tool, mcp_client)
```

`_refresh_tools()` 对每个 `mcp.types.Tool` 调用
`MCPToolDefinition.create()`。对本实验，预期生成：

```text
MCPToolDefinition
  name = get_project_info
  description = Return fixed metadata for the local AI-tools-lab MCP study.
  action_type = MCPToolAction
  observation_type = MCPToolObservation
  executor = MCPToolExecutor(
      tool_name="get_project_info",
      client=<already connected MCPClient>
  )
```

其中 `mcp_tool.inputSchema` 会用于动态创建 Pydantic 参数模型。LLM 提供的参数会先在 `action_from_arguments()` 中校验；本 Tool 的有效业务参数是空对象 `{}`。

### 4.2 Tool 如何进入 LLM

Agent 把 `tools_map` 中所有 `ToolDefinition` 交给 `LLM.generate()`。LLM 层再调用 `ToolDefinition.to_openai_tool()` 或 Responses API 对应转换，将 Tool name、description 和 schema 传给模型。

因此 Tool 发现与 Tool 选择是两个不同阶段：

```text
FastMCP tools/list 负责“OpenHands 知道有哪些 Tool”
LLM tool calling 负责“本轮是否选择 get_project_info”
```

## 5. `ActionEvent` 调用链

### 【源码确认事实】

当 LLM 返回名为 `get_project_info` 的 tool call 后：

```text
Agent._step()
  → llm.generate(..., tools=list(self.tools_map.values()))
  → ResponseDispatchMixin._handle_tool_calls()
  → Agent._get_action_event()
      → tools_map["get_project_info"]
      → MCPToolDefinition.action_from_arguments({})
      → MCPToolAction(data={})
      → ActionEvent(
           tool_name="get_project_info",
           action=MCPToolAction(data={}),
           ...
        )
  → confirmation policy（如已配置）
  → Agent._execute_actions()
  → Agent._execute_action_event()
  → MCPToolDefinition.__call__()
  → MCPToolExecutor.__call__()
```

`ActionEvent` 是 Agent 层事件，不是 MCP wire message。真正的 MCP 请求只在 `MCPToolExecutor` 之后产生。

Tool annotations 中的 `readOnlyHint` 会参与 OpenHands 风险信息处理，但 annotations 是提示信息，不是操作系统沙箱，也不能替代用户确认或 Server 侧权限控制。

## 6. FastMCP Client 调用过程

OpenHands 的 `MCPClient` 继承：

```python
fastmcp.Client
```

并增加同步/异步桥接、后台事件循环和清理逻辑。执行本 Tool 时的核心路径是：

```text
MCPToolExecutor.__call__()
  → client.call_async_from_sync(
        MCPToolExecutor.call_tool,
        action=MCPToolAction(data={})
    )
  → MCPToolExecutor.call_tool()
  → client.call_tool_mcp(
        name="get_project_info",
        arguments={}
    )
  → stdio transport
  → TypeScript project-info-server
  → get_project_info handler
  ← mcp.types.CallToolResult
```

若连接丢失，`call_tool()` 会尝试重连一次；异常和超时会转换为带 `is_error=True` 的 `MCPToolObservation`，而不是把原异常直接作为正常结果交给模型。

### 【未验证】协议版本互操作

第五阶段 TypeScript Client 2.3.1 与 Server 协商到了 modern era `2026-07-28`。当前 OpenHands 锁文件使用 FastMCP `3.2.0` 和 Python MCP SDK `1.28.1`，实际 stdio 握手可能走传统 `initialize` 路径。

当前没有运行这组 Python Client ↔ TypeScript Server 组合，所以不能仅凭版本号断言兼容或不兼容。它是下一次真实实验必须保留的首要 Evidence。

## 7. `CallToolResult` 如何变成 Observation

### 【源码确认事实】

```text
mcp.types.CallToolResult
  → MCPToolObservation.from_call_tool_result()
  → Agent._execute_action_event()
  → ObservationEvent(
       observation=<MCPToolObservation>,
       action_id=<ActionEvent.id>,
       tool_name="get_project_info",
       tool_call_id=<LLM tool call id>
    )
  → Conversation event history
  → 下一轮 LLM 上下文
```

`MCPToolObservation.from_call_tool_result()` 当前执行以下转换：

- 先加入文本：`[Tool 'get_project_info' executed.]`；
- MCP `TextContent` 转成 OpenHands `TextContent`；
- MCP `ImageContent` 转成 data URL 形式的 OpenHands `ImageContent`；
- `result.isError` 复制到 Observation 的 `is_error`；
- 其他未支持 content block 类型会被警告并忽略。

### 一个重要的数据边界

第五阶段的 Server 同时返回：

- `content[0].text`：JSON 字符串；
- `structuredContent`：结构化项目数据。

当前 `from_call_tool_result()` 只遍历 `result.content`，没有把
`structuredContent` 或 `_meta` 保存成 `MCPToolObservation` 的独立结构化字段。因此后续 Agent 预期能看到文本 JSON，但**不能把第五阶段 Client 直接读取到的 `structuredContent` 等同于 OpenHands Observation 中仍然保留的结构化对象**。

这不妨碍模型理解当前固定 JSON 文本，但对未来需要机器可验证结构化输出的 Tool 是一个集成限制。

## 8. 与第五阶段 TypeScript Client 实验比较

| 维度 | 第五阶段：TypeScript Client | 第七阶段：OpenHands 集成 |
|---|---|---|
| 目标 | 验证 MCP 协议 Client/Server | 验证 Agent 如何发现、选择、执行并消费 MCP Tool |
| Client | `@modelcontextprotocol/client@2.3.1` | Python `MCPClient`，继承 FastMCP Client |
| Transport | 注入 `fetch` 的同进程 Streamable HTTP harness | 计划使用 stdio 子进程 |
| Tool 发现 | `client.listTools()` | `client.list_tools()` → `MCPToolDefinition.create()` |
| Tool 选择 | 实验代码直接指定 Tool | LLM 或 `TestLLM` 产生 tool call |
| 调用对象 | `Client.callTool()` | `ActionEvent` → `MCPToolExecutor` → `call_tool_mcp()` |
| 结果对象 | 原始 `CallToolResult` | `MCPToolObservation` → `ObservationEvent` |
| `structuredContent` | 实际读取并断言 | 当前适配器不保留为独立 Observation 字段 |
| Agent loop | 无 | 有，Observation 进入下一轮上下文 |
| 当前状态 | **已真实验证** | **仅源码确认，尚未运行** |

## 9. 后续最小真实验证方案

### 9.1 需要先获得的授权

只需要安装 Software Agent SDK 锁定依赖到独立 Python 3.12/3.13 环境；不需要完整 OpenHands Web/Canvas、Docker、真实 LLM、账号、Token 或外部 MCP 服务。

### 9.2 无真实 LLM 的 Agent Layer 验证

SDK 自带 `openhands.sdk.testing.TestLLM`，可以返回脚本化响应。后续可让它依次返回：

1. 对 `get_project_info`、参数 `{}` 的 `MessageToolCall`；
2. 一条普通完成消息，用于结束 Agent loop。

这能在不访问任何 LLM API 的情况下真实覆盖：

```text
LocalConversation
→ MCP Server 启动与 tools/list
→ MCPToolDefinition 注册
→ TestLLM tool call
→ ActionEvent
→ FastMCP stdio tools/call
→ CallToolResult
→ MCPToolObservation
→ ObservationEvent
→ 下一轮 TestLLM
```

### 9.3 PASS 标准

后续只有同时满足以下条件，才能把 OpenHands 集成标记为已验证：

- `agent.tools_map` 中存在 `get_project_info`；
- 事件流中存在对应 `ActionEvent`；
- Action 的类型是 `MCPToolAction`，`data == {}`；
- Server 返回的固定项目 JSON 出现在 `MCPToolObservation` 文本内容；
- 事件流中存在匹配同一 tool call 的 `ObservationEvent`；
- Observation 的 `is_error` 为 false；
- Agent 进行下一轮并消费 Observation；
- 两个 OpenHands submodule 仍为 clean；
- 没有真实账号、Token、Cookie、外部 API 或文件系统 Tool 被启用。

## 10. 安全边界

### 【已确认事实】

- `get_project_info` handler 只返回源码中的固定 `PROJECT_INFO` 常量；
- Tool handler 没有文件系统 API、网络 API、环境变量读取或账号权限；
- Tool annotations 声明只读、非破坏、幂等、非开放世界；
- 本阶段没有运行 Server，没有连接外部服务，没有安装依赖；
- 没有修改 OpenHands、Software Agent SDK 或官方 MCP submodule。

### 【合理推测】

- 使用直接 `node.exe` + 本地 `tsx` CLI 的 stdio 配置，可避免系统 PATH 与全局 npm 包带来的漂移；
- 使用 `TestLLM` 比真实模型更适合首次集成验证，因为 Tool 选择是确定性的，也不需要账号或 Token。

### 【未验证】

- FastMCP `3.2.0` / Python MCP `1.28.1` 与当前 TypeScript Server `2.3.1` 的实际 stdio 互操作；
- Windows 下该具体命令、参数和 `cwd` 组合是否一次启动成功；
- OpenHands 实际发现到的 Tool schema 是否与第五阶段结果完全一致；
- Agent 事件流中实际生成的 Action/Observation id 与内容；
- Server 进程在 Conversation 关闭后是否按预期清理。

## 11. 本阶段最终状态

```text
环境检查：DONE
依赖安装：NOT RUN
OpenHands 启动：NOT RUN
MCP Server 启动：NOT RUN
源码配置路径：CONFIRMED
MCPToolDefinition 生成路径：CONFIRMED
ActionEvent 调用路径：CONFIRMED
FastMCP 调用路径：CONFIRMED
CallToolResult → Observation 路径：CONFIRMED
OpenHands 真实集成：PENDING DEPENDENCY AUTHORIZATION
```

## 参考路径

- [第五阶段 MCP Server 设计](05-first-server.md)
- [第五阶段真实协议结果](06-first-server-result.md)
- [自建 Server factory](../servers/project-info-server/src/project-info-server.ts)
- [自建 stdio 入口](../servers/project-info-server/src/server.ts)
- [OpenHands MCP 配置模型](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/mcp/config.py)
- [OpenHands MCP Client](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/mcp/client.py)
- [MCP Tool 创建](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/mcp/utils.py)
- [MCP ToolDefinition 与 Executor](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/mcp/tool.py)
- [MCP Observation 转换](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/mcp/definition.py)
- [Conversation 注册运行时 MCP Tool](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py)
- [Agent Action/Observation 执行](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/agent/agent.py)
- [LLM Tool Call 分发](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/agent/response_dispatch.py)
