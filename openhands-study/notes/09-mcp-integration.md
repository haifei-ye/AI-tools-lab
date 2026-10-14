# OpenHands 与 MCP 集成

> 研究范围：只读分析本地两个官方 submodule，不启动 Agent Server、Canvas、MCP Server、Docker 或完整 OpenHands 环境，不修改官方源码。
>
> 源码快照：
>
> - `openhands-study/openhands`：`2bdc0e9d6c5940bc3d4667fb2127fbb753b2f7c8`
> - `openhands-study/software-agent-sdk`：`7bd668c9ab74f62c85745cd95adb503f53e7228b`

## 1. 结论先行

**OpenHands 原生支持把外部 MCP Server 的 Tool 接入 Agent 工具系统。** 当前源码已经包含：

- 持久化的 `mcp_config`；
- `stdio`、`http`、`streamable-http`、`sse` 传输配置；
- API key、Bearer、Basic、Header 和 OAuth 等认证配置；
- 基于 FastMCP 的协议客户端；
- `tools/list` 发现和 `notifications/tools/list_changed` 动态刷新；
- `mcp.types.Tool → MCPToolDefinition` 适配；
- MCP 参数 schema 到 LLM tool schema 的转换与运行时验证；
- `tools/call → CallToolResult → MCPToolObservation → ObservationEvent`；
- Canvas 的 MCP 配置、连接测试、OAuth 和启用/禁用界面；
- Agent Plugins、Skills、Profiles 和 ACP Agent 的 MCP 配置路径。

但“原生支持 MCP”需要限定含义：

1. **已确认：OpenHands 是 MCP Client/Consumer。** 它连接外部 MCP Server，发现工具，并把工具交给 Agent 使用。
2. **未发现：OpenHands Agent Server 把自身工具完整暴露为 MCP Server 的协议入口。** `openhands-agent-server/.../mcp_router.py` 是供 Canvas/TypeScript 客户端测试配置和协调 OAuth 的 HTTP REST 路由，不是 MCP 协议 Server。
3. `MCPServer` 是 OpenHands 的**服务器配置模型**，不是运行中的 Server 进程。
4. TypeScript 中的 `MCPClient` 是 **Agent Server REST 客户端**；真正执行 MCP `list_tools` 和 `call_tool_mcp` 的协议客户端是 Python `MCPClient`，它继承 FastMCP `Client`。

因此，当前准确表述是：

> OpenHands 原生支持作为 MCP 客户端消费外部工具，并把这些工具适配为自身的 `ToolDefinition`；本次静态研究没有确认它提供通用 MCP Server 托管入口。

## 2. MCP 在 OpenHands 中的位置

### 2.1 总体结构

```text
Canvas / SDK 用户
→ 配置 mcp_config
→ Agent / Conversation 初始化
→ Python MCPClient（FastMCP Client）
→ 外部 MCP Server
→ tools/list
→ MCPToolDefinition
→ Agent.tools_map
→ LLM 选择 Tool
→ tools/call
→ MCPToolObservation
→ ObservationEvent
→ 下一轮 LLM 决策
```

关键文件：

| 文件 | 类/函数 | 作用 |
|---|---|---|
| `software-agent-sdk/openhands-sdk/openhands/sdk/mcp/config.py` | `MCPServer` | 描述一个 MCP Server 的 transport、地址、命令、认证和启用状态 |
| 同上 | `enabled_mcp_servers()` | 过滤已禁用的 Server |
| 同上 | `to_fastmcp_mcp_config()` | 把 OpenHands 配置转换为 FastMCP 配置 |
| `software-agent-sdk/openhands-sdk/openhands/sdk/mcp/client.py` | `MCPClient` | 继承 FastMCP Client，增加同步桥接和生命周期管理 |
| `software-agent-sdk/openhands-sdk/openhands/sdk/mcp/utils.py` | `create_mcp_tools()` | 建立连接、发现工具并创建 OpenHands Tool |
| 同上 | `_connect_and_list_tools()` / `_refresh_tools()` | 调用 `list_tools()` 并协调新增、更新和移除 |
| `software-agent-sdk/openhands-sdk/openhands/sdk/mcp/tool.py` | `MCPToolDefinition` | 把 MCP Tool 适配为 OpenHands `ToolDefinition` |
| 同上 | `MCPToolExecutor` | 经 MCP Client 发起真实 Tool Call |
| `software-agent-sdk/openhands-sdk/openhands/sdk/mcp/definition.py` | `MCPToolAction` / `MCPToolObservation` | OpenHands 事件系统中的 MCP Action/Observation |
| `software-agent-sdk/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py` | `_runtime_mcp_tools_for_agent()` | 在会话初始化时物化 MCP Tools |
| 同上 | `_ensure_agent_ready()` | 初始化 Agent 后把运行时 MCP Tools 加入 Agent |
| `software-agent-sdk/openhands-sdk/openhands/sdk/agent/base.py` | `add_runtime_tools()` | 注册运行时发现的 ToolDefinition |
| 同上 | `_on_mcp_tools_changed()` / `_on_mcp_tools_reconciled()` | 处理动态 Tool 列表变化 |

### 2.2 配置层

`AgentBase.mcp_config` 的类型是：

```text
dict[str, MCPServer]
```

键是稳定的 Server 名称，值是 `MCPServer` 配置。它不是常见 `.mcp.json` 的整个：

```json
{"mcpServers": {...}}
```

外层包装；OpenHands 在配置边界可以通过 `coerce_mcp_config()` 兼容并拆出 Server map，但内部使用扁平的 Server map。

`MCPServer` 支持：

```text
transport: stdio | http | streamable-http | sse
command / args / env / cwd
url / headers
auth
timeout / sse_read_timeout / keep_alive
enabled
```

传输约束：

- `stdio` 必须提供 `command`；
- HTTP/SSE 类远端传输必须提供 `url`；
- `enabled=false` 的配置会被保留，但不会建立连接或暴露给 Agent；
- 配置中的 secret 引用在 Conversation 知道 secret registry 后才展开。

配置来源不止 Canvas 设置：Agent Plugins、Skills 的 `.mcp.json`、Profiles、程序化 Agent 设置都可能提供 MCP Server。`LocalConversation._ensure_plugins_loaded()` 合并配置并展开 secret，然后才进入运行时发现。

## 3. MCP Tool 如何进入 OpenHands Tool 系统

### 3.1 Conversation 启动阶段

主调用链：

```text
LocalConversation.send_message() / arun()
→ LocalConversation._ensure_agent_ready()
→ _ensure_plugins_loaded()
→ AgentBase._initialize(state)
→ _runtime_mcp_tools_for_agent()
→ _runtime_mcp_tools(agent.mcp_config)
→ MCPToolProvider.create_tools()
→ DefaultMCPToolProvider
→ create_mcp_tools()
```

这里有三个重要边界：

1. 构造 `LocalConversation` 时不会立即做 MCP 网络或子进程 I/O；首次使用时才惰性初始化。
2. 只有 `enabled_mcp_servers()` 保留下来的 Server 会连接。
3. MCP Server 启动或连接失败时，`_runtime_mcp_tools()` 记录警告并返回空列表，会话可以在没有这些 MCP Tools 的情况下继续，而不是让整个 Agent 初始化必然失败。

### 3.2 Discovery：发现工具

```text
create_mcp_tools(mcp_config)
→ _prepare_mcp_config()
→ to_fastmcp_mcp_config()
→ MCPClient(FastMCPConfig)
→ MCPClient.connect()
→ FastMCP Client 建立 stdio/HTTP/SSE 会话
→ client.list_tools()
→ list[mcp.types.Tool]
```

每个 `mcp.types.Tool` 通常包含：

- `name`；
- `description`；
- `inputSchema`；
- 可选 `outputSchema`；
- `annotations`；
- `_meta` 等 MCP 元数据。

发现不是只执行一次。`_ToolListChangedHandler` 监听：

```text
notifications/tools/list_changed
```

收到通知后重新调用 `list_tools()`，`_refresh_tools()` 对 Tool 做新增、替换和移除协调，然后通过 `AgentBase._on_mcp_tools_reconciled()` 原子更新 `tools_map`。这支持逐步披露工具的 MCP Server。

### 3.3 转换为 ToolDefinition

```text
mcp.types.Tool
→ MCPToolDefinition.create(mcp_tool, mcp_client)
→ MCPToolDefinition
   ├─ name = mcp_tool.name
   ├─ description = mcp_tool.description
   ├─ annotations = ToolAnnotations
   ├─ action_type = MCPToolAction
   ├─ observation_type = MCPToolObservation
   └─ executor = MCPToolExecutor
```

`MCPToolDefinition` 继承通用：

```text
ToolDefinition[MCPToolAction, MCPToolObservation]
```

这一步是 MCP 与 OpenHands Tool 系统之间的核心适配器。转换完成后，Agent 处理 MCP Tool 的方式与原生 Tool 基本一致。

`MCPToolDefinition._get_tool_schema()` 直接以 MCP Server 提供的 `inputSchema` 为权威来源，并加入 OpenHands 的：

- `summary`；
- 在适用时加入 `security_risk`；
- response schema。

这样可以保留嵌套 JSON Schema，供 OpenAI tool calling 或 Responses API 使用。运行时又会通过 `_create_mcp_action_type()` 动态创建 Pydantic schema，对模型产生的参数进行验证。

### 3.4 注册到 Agent

```text
create_mcp_tools()
→ MCPClient.tools
→ LocalConversation._runtime_mcp_tools_for_agent()
→ AgentBase.add_runtime_tools()
→ AgentBase._tools / tools_map
```

注册阶段还会：

- 应用 `filter_tools_regex`；
- 检查 Tool 名称重复；
- 阻止 MCP Tool 与已有原生 Tool 冲突；
- 允许同一个 MCP Client 更新自己已经注册的 Tool；
- 用锁保护动态更新，给调用方返回 `tools_map` 快照。

## 4. MCP Server、Client、ToolDefinition 的关系

### 4.1 四个容易混淆的对象

| 名称 | 实际含义 | 是否执行协议 |
|---|---|---|
| 外部 MCP Server | 真正提供 Tool 的进程或远端服务 | 是，响应 `tools/list`、`tools/call` 等 MCP 请求 |
| OpenHands `MCPServer` | Pydantic 配置模型 | 否，只描述如何连接 Server |
| Python `MCPClient` | FastMCP Client 子类 | 是，连接 Server、发现和调用 Tool |
| TypeScript `MCPClient` | Agent Server REST 客户端 | 否，不直接讲 MCP 协议；调用 `/api/mcp/test` 和 OAuth REST API |
| `MCPToolDefinition` | MCP Tool 到 OpenHands Tool 的适配器 | 间接，通过 `MCPToolExecutor` 调用 Python MCPClient |

### 4.2 对象关系

```text
MCPServer 配置
→ FastMCPConfig
→ Python MCPClient
→ 外部 MCP Server
→ mcp.types.Tool
→ MCPToolDefinition
→ MCPToolExecutor（持有 MCPClient）
→ Agent.tools_map
```

`MCPToolDefinition` 不是另一个 Server，也不是协议连接。它负责把协议层发现的 Tool 变成 Agent 可以理解的统一对象。

多个由同一 `create_mcp_tools()` 发现的 Tool 会共享该 `MCPClient` 连接。Conversation 关闭运行时 Tool 时调用 executor 的 `close()`；`MCPClient.sync_close()` 是幂等的，用于清理后台事件循环和连接资源。

### 4.3 Canvas/TypeScript 的位置

TypeScript 主要负责配置与探测：

```text
AgentServerClient.mcp
→ TypeScript MCPClient
→ HttpClient
→ POST /api/mcp/test
→ POST /api/mcp/oauth/start
→ GET  /api/mcp/oauth/status/{jobId}
→ POST /api/mcp/oauth/callback/{jobId}
```

Agent Server 的 `mcp_router.py` 收到测试请求后：

```text
test_mcp_server()
→ thread executor
→ _probe_mcp_server()
→ create_mcp_tools()
→ connect + tools/list
→ 可选 _run_tool_call() 验证凭证
→ MCPTestSuccess / MCPTestFailure
```

这是“安装/配置时探测”链，不是 Agent 每轮执行 MCP Tool 的主链。

## 5. MCP 调用完整流程

### 5.1 Discovery

```text
mcp_config
→ enabled_mcp_servers
→ to_fastmcp_mcp_config
→ MCPClient.connect
→ FastMCP transport
→ 外部 MCP Server
→ client.list_tools
→ mcp.types.Tool
→ MCPToolDefinition.create
→ Agent.add_runtime_tools
```

动态变化：

```text
MCP Server
→ notifications/tools/list_changed
→ _ToolListChangedHandler.on_tool_list_changed
→ _refresh_tools
→ AgentBase._on_mcp_tools_reconciled
→ tools_map 更新
```

### 5.2 Tool 选择

```text
Agent.astep
→ prepare_llm_messages(state.view)
→ LLM.agenerate(
     messages=...,
     tools=list(self.tools_map.values())
   )
→ MCPToolDefinition.to_openai_tool / to_responses_tool
→ LLM 看到 name + description + inputSchema
→ LLM 返回 tool call
```

LLM 并不知道某个 Tool 一定是本地 Python Tool 还是 MCP Tool；二者都通过统一 Tool schema 暴露。它主要根据名称、描述、参数和上下文选择。

### 5.3 Tool Call

```text
LLM tool call
→ ResponseDispatchMixin._handle_tool_calls / _ahandle_tool_calls
→ Agent._get_action_event
→ tools_map[tool_name]
→ MCPToolDefinition.action_from_arguments
→ 动态 Pydantic schema 验证
→ MCPToolAction(data=sanitized_arguments)
→ ActionEvent
→ Agent._execute_action_event
→ ToolDefinition.__call__
→ MCPToolDefinition.__call__
→ MCPToolExecutor.__call__
```

调用前，`MCPToolExecutor.__call__()` 会只从 Conversation secret registry 展开 Action 中的 secret 引用，不会读取宿主环境变量。

### 5.4 Result

```text
MCPToolExecutor.call_tool
→ 如果断线，尝试重连一次
→ MCPClient.call_tool_mcp(
     name=tool_name,
     arguments=action.to_mcp_arguments()
   )
→ MCP Server tools/call
→ mcp.types.CallToolResult
```

这里使用 `call_tool_mcp()` 而不是会因 `isError` 抛异常的高层调用，以便把 MCP 的 in-band error 当作结果数据交还 Agent。

### 5.5 Observation

```text
CallToolResult
→ MCPToolObservation.from_call_tool_result
→ TextContent / ImageContent
→ is_error = result.isError
→ secret masking
→ ObservationEvent
→ EventLog / state.view
→ 下一轮 Agent.astep
```

当前转换明确支持 MCP Text 和 Image content block；其他 block 类型会记录警告并忽略。因此，不能假设 MCP Server 返回的每种内容类型都能无损进入 LLM 上下文。

完整速查：

```text
Discovery
→ MCP Tool 转为 ToolDefinition
→ tools_map
→ LLM 选择 Tool
→ tool call 参数验证
→ ActionEvent
→ MCPToolExecutor
→ MCP Client
→ MCP Server
→ CallToolResult
→ MCPToolObservation
→ ObservationEvent
→ LLM 根据结果继续
```

## 6. MCP Tool 与 OpenHands 原生 Tool 比较

### 6.1 相同点

| 共同点 | 说明 |
|---|---|
| 统一抽象 | 最终都成为 `ToolDefinition` |
| 统一选择 | 都以 tool schema 交给 LLM |
| 统一事件 | 都产生 `ActionEvent` 和 `ObservationEvent` |
| 统一执行入口 | 都经过 `Agent._execute_action_event()` 和 `ToolDefinition.__call__()` |
| 参数验证 | 都会在执行前验证结构化参数 |
| 下一轮反馈 | Observation 都进入 EventLog/View，影响下一轮 LLM |
| 安全元数据 | 都可使用 `ToolAnnotations`、安全分析和确认策略 |
| 工具过滤 | 都受 `filter_tools_regex` 和名称冲突检查影响 |

### 6.2 不同点

| 维度 | OpenHands 原生 Tool | MCP Tool |
|---|---|---|
| 来源 | Python 代码中的 ToolDefinition/ToolExecutor | 外部 MCP Server 在运行时发布 |
| 注册时机 | Agent 初始化时根据 preset/配置创建 | 连接 MCP Server 后经 `tools/list` 动态发现 |
| schema | 由本地 Pydantic Action/Observation 定义 | 以 Server 提供的 MCP JSON Schema 为权威来源 |
| 执行位置 | OpenHands Runtime 内的本地 executor | 外部进程、远端服务或 stdio 子进程 |
| 通信 | Python 函数调用 | MCP transport + 协议请求 |
| 生命周期 | 通常跟随 Conversation/Runtime | 还需管理连接、后台 loop、重连和 Server 生命周期 |
| 动态变化 | 通常较稳定 | 可通过 `tools/list_changed` 增删改 |
| 错误来源 | 本地验证、文件、Shell、库异常 | 额外包含连接、认证、超时、协议和远端业务错误 |
| 延迟 | 通常较低且可预测 | 可能受网络、子进程启动和远端限流影响 |
| 内容转换 | 可定义专门 Observation 类型 | 当前适配明确保留 Text/Image，其他 block 可能丢失 |
| 信任边界 | OpenHands 自己维护的代码 | 外部 Server 的 schema、描述、annotations 和结果均需视为外部输入 |

### 6.3 MCP Tool 的优点

- 标准化扩展：工具提供方不需要修改 OpenHands 核心代码；
- 跨语言：Server 可以用任意支持 MCP 的语言实现；
- 解耦部署：数据、SaaS、链上服务或企业系统可独立发布；
- 复用：同一 MCP Server 可被多个 Agent/客户端使用；
- 运行时发现：工具可以按 Server 能力动态变化；
- 配置化：Agent、Profile、Skill 或 Plugin 可以组合不同 Server。

### 6.4 MCP Tool 的缺点和成本

- 增加连接、认证、OAuth、版本和超时管理；
- 远端服务的可用性和延迟进入 Agent 关键路径；
- Tool 描述和 annotations 来自外部，不能自动等同于可信安全声明；
- Tool 名称可能冲突，动态更新也可能改变 Agent 可用能力；
- MCP `isError=false` 不代表业务成功，很多 API 会把业务失败放在普通文本中；
- 外部调用可能产生真实副作用、费用、数据泄露或不可逆操作；
- Result 到 Observation 的适配可能丢失未支持的 content block；
- 仅靠 LLM 选择 Tool 不能替代确定性的权限、审批和策略控制。

### 6.5 原生 Tool 的优缺点

优点：

- 与 OpenHands Conversation、Workspace、Runtime 和事件模型结合最深；
- 类型和 Observation 可以针对工程任务精细设计；
- 本地调用链较短，测试、性能和错误语义更容易控制；
- 适合 Terminal、FileEditor、TaskTracker 这类核心执行能力。

缺点：

- 新能力通常需要修改、发布并升级 OpenHands 包；
- 与外部系统耦合容易污染核心代码；
- 复用到其他 Agent 客户端的成本更高；
- 第三方接入门槛高于部署独立 MCP Server。

合理的边界是：**核心工程执行原语优先原生 Tool；独立业务系统、数据源和跨产品集成优先 MCP。**

## 7. 安全与可靠性边界

### 7.1 已确认的保护

- Server 可以保持配置但设为 `enabled=false`；
- OpenHands 支持多种认证模型和 OAuth 状态持久化；
- secret 引用从 Conversation secret registry 按需展开；
- MCP Observation 的文本在返回 Agent 前尝试遮蔽 secret；
- MCP input schema 在 ActionEvent 创建时和执行时都会验证；
- Tool annotations 会映射为 OpenHands `ToolAnnotations`；
- Tool 名冲突会阻止静默覆盖；
- Tool 启动、调用和列表刷新有超时及错误处理；
- Agent 的安全分析、确认模式和 pre-tool hook 仍可作用于统一 Action 流程。

### 7.2 不能误解为安全保证的部分

- `readOnlyHint`、`destructiveHint` 等 annotations 由 Tool/Server 提供，属于元数据，不是权限沙箱；
- MCP 协议不会自动限制 Server 能访问哪些文件、网络、钱包或账户；
- OAuth 成功只证明获得授权，不证明授权范围最小；
- `isError=false` 只代表 MCP 层没有标记错误，不等于业务结果正确；
- secret masking 是输出防护，不应作为允许把高价值密钥交给不可信 Server 的理由；
- Docker Runtime 隔离 OpenHands 本地执行，并不会自动隔离远端 MCP Server 的行为；
- 用户安装的 stdio Server 本质上是在相应 Runtime 中启动第三方程序，仍需审查来源和权限。

## 8. 未来应用

以下是基于当前扩展机制的合理应用方向，不代表这些业务 MCP Server 已由本仓库提供，也不代表已经完成生产验证。

### 8.1 Web3 Agent

适合通过 MCP 接入：

- 区块链 RPC 和索引服务；
- 区块、交易、合约事件查询；
- ABI 查询和交易 calldata 构造；
- Gas、余额、代币和协议数据读取；
- 交易模拟、风险扫描和多签提案创建。

建议调用链：

```text
用户任务
→ 只读链上查询 Tool
→ Agent 生成分析/交易草案
→ 模拟 Tool
→ 策略与 allowlist 校验
→ 人工确认
→ 外部钱包/多签签名
→ 广播
→ 链上回执 Observation
```

风险控制：

- 私钥、助记词不应直接进入 LLM、普通 secret registry 或第三方 MCP Server；
- 签名与广播应和数据查询分层；
- 默认只读，写操作单独授权；
- 限定 chain id、合约 allowlist、金额、滑点和 Gas；
- 广播前必须模拟并显示人类可读差异；
- 使用硬件钱包或多签，把 MCP Tool 限定为“提案”而非任意签名。

### 8.2 量化研究 Agent

适合通过 MCP 接入：

- 行情和基本面数据目录；
- 数据库查询；
- 因子注册表；
- 回测服务；
- 实验元数据和报告存储；
- 只读的交易/持仓快照。

建议分层：

```text
数据 MCP（只读、带时间戳和版本）
→ 研究 Agent
→ Workspace 中生成代码/实验配置
→ Runtime 运行回测
→ 结果与数据 lineage
→ 人工复核

交易执行 MCP（独立权限域）
→ 默认不暴露给研究 Agent
→ 仅经明确审批和风控策略调用
```

关键要求：

- point-in-time 数据和可重复快照；
- 明确时区、交易日和已闭合数据；
- 每个结果保留数据版本、参数、代码 commit 和运行环境；
- 研究与实盘账户权限分离；
- 查询幂等，写入 append-only 或有版本控制；
- 不让自然语言 Tool 描述取代正式风控 Gate。

### 8.3 自动化 Agent

适合通过 MCP 接入：

- 工单、CRM、邮件、日历、知识库；
- CI/CD、监控和告警；
- 文档、云存储和审批系统；
- 内部业务 API。

建议模式：

```text
Trigger
→ Agent 读取上下文
→ MCP Tool 获取外部状态
→ 生成操作计划
→ policy / approval gate
→ MCP Tool 执行
→ Result
→ Observation
→ 幂等校验与审计记录
```

关键要求：

- 读写 Tool 分离，写操作默认需确认；
- 每次写操作带 idempotency key；
- 最小 OAuth scope 和独立服务账号；
- 限流、重试、退避与明确超时；
- 保存 Tool 名、参数摘要、操作者、结果和外部对象 ID；
- 对删除、付款、发布、发送消息等不可逆操作设置强审批边界；
- 把“计划成功”和“外部系统实际完成”分开记录。

## 9. REA TypeScript 分析

### 9.1 分析边界

分析目录：

```text
software-agent-sdk/clients/typescript/src/client
```

重点文件：

```text
mcp-client.ts
http-client.ts
agent-server-compatibility.ts
openhands-client.ts
settings-client.ts
```

执行环境：

```text
Node v24.18.0
rea-agents@6.4.0
analyze-javascript-application --json
```

没有保存 raw output，没有向 submodule 写入文件。

### 9.2 结果与 Evidence

| 指标 | 结果 |
|---|---:|
| exit code | 0 |
| relevant files | 28 |
| parsed JavaScript/TypeScript files | 28 |
| parse failures | 0 |
| text bytes read | 148,640 |
| visited AST nodes | 19,727 |
| findings | 421 |
| Application Graph nodes | 226 |
| Application Graph edges | 477 |
| Semantic Graph nodes | 10,307 |
| Semantic Graph relations | 6,497 |

Application Graph 关系：

```text
imports: 306
calls: 73
contains: 56
exposes: 42
```

Semantic Graph 主要关系：

```text
aliases: 1,978
reads: 1,864
defines: 1,013
reads-property: 674
captures: 473
awaits: 201
returns-to-call: 54
writes-property: 50
argument-to-parameter: 48
calls: 46
```

Evidence：

```text
evidence_id:
ev_48849fd97103a52074700f10597eaa572bce84aa1b24a8f25bda4e7510a88789

root_artifact_sha256:
f0b853905d7c5b0f5f66ff52e2bcb00c4a6a6cf1c4797b63fea8a3b3bac9a3b2

inventory_manifest_id:
agm_ece8f0cdefaafba490f1c0d0a1da58b0b9c53d1cb1b5e0b274cc840828a0a951

inventory_graph_sha256:
53de5867400c43f06daf058d40342b25c283a151bf052d14b6e4e2e0cd55356c

application_graph_id:
jag_a4a4e5cb3fa69d9e1a5479f99a9a6838bee5b6b6c625ea10d7bc456854970d32

semantic_graph_id:
jsrg_47b6631f785c2112b4896b1979dc097e0d5496f761508415d47ed2cda62f9c80
```

Application Graph coverage 为 complete 且未截断。Semantic Graph 总体 coverage 为 unknown；各关系族为 partial，但报告没有省略节点或关系。

### 9.3 REA 发现的关键关系

REA 确认：

```text
AgentServerClient
→ 构造 MCPClient
→ 暴露为 client.mcp

MCPClient
→ 构造 HttpClient
→ 使用 agent-server compatibility 检查
→ HttpClient.post / get
```

REA 静态识别到：

```text
/api/mcp/test
/api/mcp/oauth/start
```

源码人工核对补充了动态模板端点：

```text
/api/mcp/oauth/status/{jobId}
/api/mcp/oauth/callback/{jobId}
```

REA 还确认 `mcp-client.ts` 到 `http-client.ts` 和 `agent-server-compatibility.ts` 的 import 关系；由于分析根目录是 `src/client`，`../models/agent-server-api`、`../models/api` 等跨根目录 import 被标记为边界外/未解析。

### 9.4 REA 限制

- REA 分析的是 TypeScript 静态关系，没有执行任何请求；
- 它不能证明 Agent Server 或 MCP Server 在当前机器上可连接；
- 动态模板 URL 不一定被识别为完整 endpoint；
- TypeScript `MCPClient` 只覆盖 REST 配置探测，不代表 MCP 协议调用链；
- Python `create_mcp_tools()`、FastMCP、`MCPToolDefinition` 和 Observation 链来自人工阅读，不是 REA Evidence；
- 没有动态验证 stdio、HTTP、SSE、OAuth、重连或 `tools/list_changed`。

## 10. 事实、推测、建议与未验证项

### 已确认事实

- OpenHands SDK 直接依赖 FastMCP，并定义了 MCP Client、配置、ToolDefinition、Action 和 Observation。
- OpenHands Agent 可以把启用的 MCP Server 所发布的 Tool 加入 `tools_map`。
- MCP Tool 与原生 Tool 共用 Agent Tool Call 和事件执行框架。
- Tool 发现支持 `list_tools()` 和 `tools/list_changed` 协调。
- MCP Tool 的参数由 Server 的 `inputSchema` 驱动并进行动态验证。
- MCP 调用结果被转换为 `MCPToolObservation`，再包装为 `ObservationEvent`。
- Canvas/TypeScript 客户端支持配置测试和 OAuth REST API。
- 当前 `mcp_router` 是 REST 管理/探测路由，不是通用 MCP 协议 Server。
- 两个 submodule 在本阶段研究开始时均为 clean。

### 合理推测

- OpenHands 采用 `MCPToolDefinition` 适配层，是为了让 Agent 核心循环不需要区分工具来自本地代码还是外部协议。
- 动态 `tools/list_changed` 支持有助于 Server 做渐进式工具披露，减少首次暴露给模型的 schema 数量。
- 配置、探测和运行时协议调用分层，有利于 Canvas 保持浏览器兼容，并把凭证和子进程能力留在 Agent Server/Runtime。

这些推测与代码结构一致，但不是统一的官方设计声明。

### 主观建议

- 把 MCP 看作能力扩展协议，不要看作安全边界。
- 外部业务系统优先做 MCP Server，核心文件/Shell 工具继续使用原生 Tool。
- 对高风险 Tool 使用明确的 read-only/write 分层、最小权限、确认策略、allowlist 和审计。
- 生产部署为每个 MCP Server 设置超时、健康检查、限流、重试策略和失败降级。
- 对 MCP Server 返回的 Tool 描述、annotations 和文本结果都按外部输入处理。

### 未验证信息

- 没有启动 MCP Server，未验证真实握手、能力协商和协议版本兼容。
- 没有执行 `tools/list` 或 `tools/call`，未验证动态 Result 内容。
- 没有测试 OAuth provider、token refresh 或持久化恢复。
- 没有测试多个 MCP Server 的名称冲突和并发刷新。
- 没有验证 Web3、量化或自动化 MCP Server；第 8 节是架构建议，不是已完成能力。
- 没有确认 OpenHands 对外提供通用 MCP Server；当前源码搜索只确认 MCP client/consumer 路径。

## 11. 最小心智模型

```text
MCP Server
= 外部能力提供者

MCP Client
= OpenHands 与外部 Server 的协议连接

MCPToolDefinition
= 把外部 Tool 翻译成 OpenHands 内部 Tool 的适配器

ActionEvent / ObservationEvent
= MCP Tool 进入 Agent 决策闭环的统一事件接口
```

最终关系：

```text
外部能力
→ MCP 标准协议
→ OpenHands ToolDefinition
→ Agent 选择与执行
→ Observation
→ 下一轮决策
```

MCP 让 OpenHands 不必把每个外部系统都写进核心代码；OpenHands 则为 MCP Tool 提供了 LLM 选择、事件历史、Workspace/Runtime、确认策略和多轮反馈闭环。
