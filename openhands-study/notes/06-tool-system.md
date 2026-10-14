# OpenHands Tool 系统

> - 研究日期：2026-10-13
> - OpenHands Canvas 快照：`2bdc0e9d6c5940bc3d4667fb2127fbb753b2f7c8`
> - Software Agent SDK 快照：`7bd668c9ab74f62c85745cd95adb503f53e7228b`

## 1. 目标、范围与前提修正

本阶段只做静态源码阅读和小范围 REA 分析，没有启动 OpenHands 完整环境、安装完整运行依赖或修改两个官方 submodule。

分析范围：

- `openhands-study/software-agent-sdk`：Tool 注册、实例化、调用、结果回流和 MCP 适配；
- `openhands-study/openhands`：Canvas 如何读取 Agent Server 的工具目录，以及前端 Client Tool 示例；
- REA：仅分析 Canvas 的 TypeScript 工具目录服务。当前使用的 REA JavaScript/TypeScript 分析命令不能分析 Python，因此 Python Agent/Tool 主链来自人工源码阅读，不冒充 REA 结论。

需要先修正三个容易误导后续研究的前提：

1. OpenHands 当前不是只有一个“Tool Registry”。源码中至少有两层：进程级工具目录 `_REG`，以及每个 Agent/Conversation 实际可用的 `_tools`/`tools_map`。
2. 当前快照没有发现名为 `RuntimeTool` 的统一类。“Runtime”主要是 Conversation、Workspace、Tool Executor 组成的执行环境；Terminal、File Editor、Browser、Task 等才是模型可调用的 Tool。
3. Agent Server 的 `/bash` 服务不是 Agent 的 `TerminalTool`。`bash_service.py` 明确把它作为独立终端事件服务，其事件不进入 Conversation 的 Agent 事件流。

## 2. 总体结构

```text
进程启动/模块导入
  → register_tool(name, factory)
  → 进程级 Registry：name → resolver/class/usability

Conversation 首次运行
  → LocalConversation._ensure_agent_ready()
  → AgentBase._initialize(state)
  → resolve_tool(Tool spec, ConversationState)
  → ToolDefinition.create(state)
  → Agent._tools / tools_map
  → 追加 MCP 等 runtime tools

每一轮 Agent
  → tools_map 中的 ToolDefinition 转为模型工具 schema
  → LLM 选择工具并返回 tool_call
  → ActionEvent
  → ToolDefinition.__call__ → ToolExecutor
  → Observation
  → ObservationEvent(role="tool")
  → 下一轮 LLM 上下文
```

这意味着“已注册”不等于“本轮模型可见”。只有被当前 Agent 规格选中、成功按当前 ConversationState 实例化，并进入 `tools_map` 的工具，才会发给 LLM。

## 3. Tool 注册机制

### 3.1 进程级 Registry

核心文件：

- `software-agent-sdk/openhands-sdk/openhands/sdk/tool/registry.py`
- `software-agent-sdk/openhands-sdk/openhands/sdk/tool/spec.py`
- `software-agent-sdk/openhands-sdk/openhands/sdk/tool/tool.py`

核心对象和函数：

| 名称 | 作用 |
|---|---|
| `_REG: dict[str, Resolver]` | 工具名到解析器的进程级映射 |
| `_TOOL_CLASSES` | 保留可用的 Tool 类 |
| `_USABILITY_REG` | 保存工具可用性检查器 |
| `register_tool(name, factory)` | 注册 ToolDefinition 实例或带 `create()` 的 ToolDefinition 子类 |
| `resolve_tool(tool_spec, conv_state)` | 用工具规格和当前 ConversationState 生成 ToolDefinition 实例 |
| `list_registered_tools()` | 返回注册名称 |
| `list_tool_catalog()` | 返回可展示目录，包括是否可选、可用、属于默认集合 |
| `seal_tool_catalog()` | 冻结目录，分离注册阶段与服务阶段 |

典型的模块级注册方式：

```text
导入 openhands.tools.terminal.definition
  → 执行模块底部 register_tool(TerminalTool.name, TerminalTool)

导入 openhands.tools.file_editor.definition
  → 执行模块底部 register_tool(FileEditorTool.name, FileEditorTool)
```

`openhands-tools/openhands/tools/preset/default.py` 中的 `register_default_tools()` 通过导入 Terminal、File Editor、Task Tracker 等定义模块触发注册；`get_default_tools()` 则返回供 Agent 使用的 `Tool` 规格。注册类和选择规格是两个不同步骤。

### 3.2 Tool 规格与 Tool 实例

`openhands/sdk/tool/spec.py` 的 `Tool` 是持久化/传输层规格，主要包含工具名和参数。它不是执行器。

`openhands/sdk/tool/tool.py` 的 `ToolDefinition` 是真正交给 Agent 的定义，主要包含：

- `description`：给模型的说明；
- `action_type`：Pydantic 输入模型；
- `observation_type`：返回值类型；
- `annotations`：只读、破坏性、幂等、开放世界等提示；
- `executor`：运行时执行器，不参与序列化；
- `prompt_guidance`、`response_schema`：额外提示和结构化结果约束。

关键方法：

```text
ToolDefinition.create(conv_state, **params)
  → 结合当前 Workspace/Conversation 创建工具实例

ToolDefinition.action_from_arguments(arguments)
  → 将 LLM 参数校验为具体 Action

ToolDefinition.__call__(action, conversation)
  → 调用 ToolExecutor
  → 校验/转换 Observation
  → 遮蔽敏感信息

ToolDefinition.to_openai_tool()/to_responses_tool()
  → 转为 LLM API 可理解的函数工具 schema
```

### 3.3 每个 Agent 的运行时工具表

文件：`software-agent-sdk/openhands-sdk/openhands/sdk/agent/base.py`

`AgentBase._initialize(state)` 执行以下步骤：

1. 遍历 `AgentBase.tools: list[Tool]`；
2. 并行调用 `resolve_tool(spec, state)`；
3. 应用 `filter_tools_regex`；
4. 添加 `include_default_tools` 中的内建工具；
5. 根据能力添加 `InvokeSkillTool`、`VisionInspectTool` 等；
6. 校验类型和重名；
7. 形成当前 Agent 的 `_tools: dict[str, ToolDefinition]`。

因此进程 Registry 是“能创建哪些工具”，`Agent.tools_map` 是“当前会话的 Agent 实际能调用哪些工具”。后者才是执行和 LLM 暴露边界。

### 3.4 运行时追加工具

`AgentBase.add_runtime_tools()` 专门接受已实例化的 `ToolDefinition`，用于 MCP 等在运行时才知道的工具。

`LocalConversation._ensure_agent_ready()` 的顺序是：

```text
_ensure_plugins_loaded()
  → 插件可合并 skills、MCP config、hooks
_register_file_based_agents()
AgentBase._initialize(state)
_runtime_mcp_tools_for_agent()
AgentBase.add_runtime_tools(runtime_mcp_tools)
AgentBase.init_state(...)
```

MCP 服务发出 `notifications/tools/list_changed` 后，`AgentBase._on_mcp_tools_changed()` 可追加或刷新工具；`_on_mcp_tools_reconciled()` 会以同一 MCP client 的最新快照替换旧工具，并移除服务器不再提供的工具。

## 4. Agent 如何发现可用 Tool

“发现”分为服务器/UI 与 LLM 两个不同含义。

### 4.1 UI 目录发现

Canvas 路径：

```text
openhands/src/hooks/query/use-tool-catalog.ts
  useToolCatalog()
    → ToolCatalogService.getCatalog()

openhands/src/api/tool-catalog-service/tool-catalog-service.api.ts
  ToolCatalogService.getCatalog()
    → ToolClient.getToolCatalog()
    → assertValidCatalog()
```

Agent Server 的 `tool_router.py` 提供 `/tools/` 和 `/tools/catalog`，后者读取 `list_tool_catalog()`。这一层服务于界面选择和可用性展示，不执行工具，也不能证明某工具已进入当前 Agent。

### 4.2 LLM 的工具发现

SDK 路径：

```text
Agent._astep()
  → tools=list(self.tools_map.values())
  → LLM.agenerate(messages, tools, ...)

LLM 参数准备
  → ToolDefinition.to_openai_tool()
  或 ToolDefinition.to_responses_tool()
  → 模型收到 name + description + JSON schema
```

文件和函数：

- `openhands/sdk/agent/agent.py`：`Agent._astep()`；
- `openhands/sdk/llm/llm.py`：工具 schema 转换和请求参数准备；
- `openhands/sdk/tool/tool.py`：`to_openai_tool()`、`to_responses_tool()`。

**已确认事实：**模型能发现的工具集合来自当前 `tools_map`，不是全局注册表，也不是 Canvas 工具目录。

## 5. Tool 调用流程

用户给出的简化链条基本正确，但更准确的源码链是：

```text
MessageEvent（用户消息已写入 Conversation 事件历史）
  → LocalConversation.arun()/run() 驱动循环
  → Agent.astep() / Agent._astep()
  → aprepare_llm_messages(state.view, ...)
  → LLM.agenerate(..., tools=tools_map.values())
  → LLM tool_call
  → Agent._ahandle_tool_calls()
  → Agent._get_action_event()
       - 解析 JSON 参数
       - normalize_tool_call()
       - tools_map.get(tool_name)
       - action_from_arguments()
       - 生成 ActionEvent
  → 用户确认/Hook/风险策略（如适用）
  → Agent._aexecute_actions()
  → _ActionBatch.aprepare()
  → ParallelToolExecutor.aexecute_batch()
  → Agent._execute_action_event()
  → ToolDefinition.__call__(action, conversation)
  → ToolExecutor.__call__()
  → Observation
  → ObservationEvent
  → 写回 Conversation
  → 下一轮 astep() 把 ObservationEvent 转为 LLM message
```

关键类型：

- `MessageEvent`：用户或 Agent 的消息事件；
- `ActionEvent`：保存模型 tool call、标准化后的 Action、tool call id、风险和摘要；
- `ObservationEvent`：保存 Tool 返回的 Observation，并通过 `action_id`/`tool_call_id` 与 Action 对应；
- `AgentErrorEvent`：参数或执行错误的一类可回流事件。

`ActionEvent.to_llm_message()` 生成带 `tool_calls` 的 `role="assistant"` 消息；`ObservationEvent.to_llm_message()` 生成带 `tool_call_id` 的 `role="tool"` 消息。这样能够维持模型 API 要求的 tool call/tool result 配对。

### 5.1 并发与资源保护

文件：`openhands/sdk/agent/parallel_executor.py`

`ParallelToolExecutor` 支持批量工具调用，但 Agent 默认的 `tool_concurrency_limit` 为 1。工具可以通过 `declared_resources(action)` 声明锁：

- 未声明资源：按工具名加互斥锁；
- 返回空资源集合：允许无资源锁并发；
- 返回资源键：按文件、终端会话等具体资源加锁。

这不是单纯的“LLM 同时发几个函数调用就并行执行”，实际并行度还受 Agent 配置和资源锁约束。

## 6. Shell、File、Runtime 等核心 Tool

### 6.1 Shell：TerminalTool

文件：

- `openhands-tools/openhands/tools/terminal/definition.py`
- `openhands-tools/openhands/tools/terminal/impl.py`

核心类型：

- `TerminalAction`
- `TerminalObservation`
- `TerminalTool`
- `TerminalExecutor`

创建链：

```text
TerminalTool.create(conv_state)
  → 读取 conv_state.workspace.working_dir
  → 创建 TerminalExecutor(working_dir, ...)
  → 返回绑定执行器的 TerminalTool
```

`TerminalExecutor` 管理持久终端后端，并根据平台/能力选择 tmux、subprocess 或 PowerShell 等实现。`TerminalObservation.to_llm_content` 会把输出、当前目录、退出码等整理为模型可读内容，并对大输出做截断/保存处理。

需要区分：`openhands-agent-server/.../bash_service.py` 的 Bash Event Service 主要服务 UI 终端，它不是上述 Agent Tool 调用链的一部分。

### 6.2 File：FileEditorTool

文件：

- `openhands-tools/openhands/tools/file_editor/definition.py`
- `openhands-tools/openhands/tools/file_editor/impl.py`

核心类型：

- `FileEditorAction`
- `FileEditorObservation`
- `FileEditorTool`
- `FileEditorExecutor`

创建和执行链：

```text
FileEditorTool.create(conv_state)
  → workspace.working_dir
  → FileEditorExecutor(workspace_root)

FileEditorExecutor.__call__()
  → view / create / str_replace / insert 等文件操作
  → 成功返回 FileEditorObservation
  → ToolError 转为带错误信息的 Observation
```

它按绝对文件路径声明 `file:<path>` 资源键，避免两个并行调用同时修改同一文件。项目中还存在更专门的文件/检索工具：

- `ApplyPatchTool`：补丁式修改，并限制路径逃逸；
- `GlobTool`、`GrepTool`：只读查找；
- `PlanningFileEditorTool`：面向 planning 文件；
- `FileEditorTool`：通用查看和编辑。

这些工具并不一定全部包含在每个 Agent 的默认集合中。

### 6.3 Browser、Task 与 Task Tracker

相关路径：

- `openhands-tools/openhands/tools/browser_use/definition.py`
- `openhands-tools/openhands/tools/task/definition.py`
- `openhands-tools/openhands/tools/task_tracker/definition.py`

`BrowserToolSet` 提供浏览器能力；`TaskToolSet` 面向子任务/子 Agent 调用；`TaskTrackerTool` 管理任务清单。它们仍遵守同一 `ToolDefinition → Action → Executor → Observation` 协议，但是否可用取决于 Agent 规格、依赖和运行环境。

### 6.4 “Runtime”真正指什么

**已确认事实：**当前快照未发现统一 `RuntimeTool` 类。Runtime 更适合拆成三部分理解：

1. `LocalConversation`：事件循环、持久化、运行时工具注入；
2. `Workspace`：工作目录及文件/命令边界；
3. 每个 `ToolExecutor`：执行具体动作并返回 Observation。

例如 `TerminalTool` 和 `FileEditorTool` 都在 `create(conv_state)` 时从 `conv_state.workspace.working_dir` 获得项目边界，但它们拥有各自的 Executor。不能把 Workspace、Agent Server `/bash` 和 LLM 可调用 Tool 合并成一个概念。

## 7. Tool 结果如何影响下一轮 Agent 决策

这部分不是隐藏的状态机，而是事件历史到 LLM 上下文的显式反馈：

```text
Observation
  → ObservationEvent
  → Conversation state/view
  → aprepare_llm_messages()
  → ObservationEvent.to_llm_message()
  → role="tool" + tool_call_id + observation content
  → 下一次 LLM.agenerate()
```

因此下一轮模型可以根据：

- 命令输出和退出码；
- 文件内容或编辑成功/失败信息；
- 浏览器结果；
- MCP `content`/错误；
- 用户拒绝或 Hook 拦截；
- 参数校验、工具执行错误；

决定继续调用工具、修正参数、改换路径、总结结果或结束任务。

**合理推测：**从行为语义看，这一“读取 Observation 后再决策”的步骤承担了大部分 reflection 功能；但源码没有保证模型一定做高质量反思，也没有一个统一的 `ReflectionEvent` 强制执行反思。结果质量仍取决于模型、Prompt、上下文压缩和 Observation 的信息质量。

**风险：**工具输出本身可能包含不可信内容。OpenHands 有类型校验、敏感信息遮蔽、确认策略和 Hook，但这些机制不能自动证明 Tool 输出真实、安全或适合继续执行。

## 8. 与 MCP Tool 模型比较

### 8.1 OpenHands 如何接入 MCP

文件：

- `openhands-sdk/openhands/sdk/mcp/utils.py`
- `openhands-sdk/openhands/sdk/mcp/tool.py`
- `openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py`
- `openhands-sdk/openhands/sdk/agent/base.py`

调用链：

```text
DefaultMCPToolProvider.create_tools(mcp_config, ...)
  → create_mcp_tools(...)
  → MCP client 连接 server
  → list_tools
  → MCPToolDefinition.create(...)
  → AgentBase.add_runtime_tools(...)

LLM 调用 MCP tool
  → ActionEvent
  → MCPToolDefinition / MCPToolExecutor
  → client.call_tool_mcp(...)
  → MCP result
  → MCPToolObservation
  → ObservationEvent
```

也就是说，MCP 没有绕过 OpenHands Agent 循环，而是被适配为 `ToolDefinition`，再使用同一 Action/Observation 事件模型。

### 8.2 相同点

| 维度 | OpenHands Tool | MCP Tool |
|---|---|---|
| 对模型的基本描述 | name、description、输入 schema | name、description、inputSchema |
| 发现 | 列表/目录后选择 | client `listTools` 获取服务器广告的工具 |
| 调用 | 工具名 + 参数 | `callTool({name, arguments})` |
| 返回 | Observation，可含错误/结构化内容 | content、可选 structuredContent、isError |
| 变化 | 可添加 runtime tools | 可通过 list changed 通知刷新 |
| LLM 接入 | 转换为 provider function schema | Host 通常也转换为模型的工具 schema |

MCP 官方 TypeScript SDK 文档确认：`listTools` 返回服务端公开的工具，`callTool` 按名称和普通参数对象调用；结果包含 `content`，失败结果可通过 `isError` 判断，声明输出 schema 时还可返回 `structuredContent`。

### 8.3 不同点

| 维度 | OpenHands 内建 Tool | MCP Tool |
|---|---|---|
| 注册位置 | Python 进程内 Registry，通常由模块导入触发 | MCP Server 对外广告，Client 运行时发现 |
| 创建上下文 | `create(ConversationState)`，可直接绑定 Workspace/Conversation | 通过协议连接远端或子进程服务，不直接共享 Python 对象 |
| 执行器 | 本地 `ToolExecutor` | `MCPToolExecutor` 调 MCP client/server |
| 返回类型 | 强类型 `Observation` 子类 | MCP content blocks / structuredContent，再适配成 Observation |
| 生命周期变化 | 通常进程注册后较稳定 | 支持 `tools/list_changed` 动态变更 |
| OpenHands 增强 | Action/Observation 持久化、风险预测、确认、Hook、资源锁、敏感信息遮蔽 | 协议本身定义发现/调用/结果；Host 决定额外治理 |
| 故障边界 | 多为同进程代码和本地运行环境 | 增加 transport、server 启动、超时、协议兼容等故障点 |

这里比较的是“OpenHands 本地 Tool 抽象”与“MCP 协议 Tool”。OpenHands 的 MCP wrapper 同时拥有两者特征：对外遵循 MCP，进入 Agent 后表现为 OpenHands `ToolDefinition`。

### 8.4 未来扩展方式

当前源码已经提供三条现实路径：

1. **Python ToolDefinition**：适合与 Workspace/Conversation 深度耦合、需要强类型 Action/Observation 和资源锁的核心能力；
2. **MCP Server**：适合跨语言、跨进程、独立部署、动态发现的外部能力；
3. **ClientTool**：`openhands/sdk/tool/client_tool.py` 允许会话创建时提交 JSON 工具规格；Agent 发出 ActionEvent 后，由前端执行真实副作用，SDK 侧执行器只返回已分发确认。Canvas 的 `canvas-ui-client-tool.ts` 是实例。

插件还能合并 skills、MCP config、hooks 和 Agent 定义，因此可把外部能力作为插件装载，而不改核心 Agent 循环。

**主观建议：**

- 新的本地编码能力优先复用已有 Tool 或实现 `ToolDefinition`，不要另造事件循环；
- 跨语言/独立服务优先 MCP，把权限、超时、版本和输出 schema 当成正式接口治理；
- 必须由浏览器/UI 完成的交互才使用 ClientTool；
- 不要仅因为工具“出现在 catalog”就认为它已对某个 Agent 生效，应检查 `tools_map`、依赖可用性和运行时注入结果。

## 9. REA 分析结果与 Evidence

### 9.1 分析对象与命令

REA 只分析 Canvas 的工具目录服务：

```text
目标：openhands-study/openhands/src/api/tool-catalog-service
命令：npx -y rea-agents@6.4.0 analyze-javascript-application <target> --json
退出码：0
```

原始 JSON 保存于被 `.gitignore` 排除的：

`openhands-study/rea-analysis/raw-output/tool-catalog-rea-6.4.0.json`

它用于复核，不属于学习笔记提交范围。

### 9.2 已确认指标

| 指标 | 结果 |
|---|---:|
| parsed JavaScript/TypeScript files | 2 |
| parse failures | 0 |
| AST nodes visited | 545 |
| findings | 26 |
| application graph | 23 nodes / 31 edges |
| application edges | contains 4 / imports 25 / exposes 2 |
| semantic graph | 310 nodes / 287 relations |
| semantic status | `unknown`，未截断 |

主要 semantic relations：

- `aliases`: 93
- `reads`: 74
- `captures`: 44
- `defines`: 33
- `reads-property`: 22
- `calls`: 5
- `awaits`: 5
- `returns-to-call`: 5
- `argument-to-parameter`: 3

### 9.3 REA 发现的关键关系

REA 在 `tool-catalog-service.api.ts` 中定位到：

```text
isToolCatalogEntry()
  → 校验单个目录项结构

assertValidCatalog()
  → 校验 API 返回目录

ToolCatalogService.getCatalog()
  → new ToolClient(...)
  → await client.getToolCatalog()
  → assertValidCatalog(response)
  → 返回已校验 catalog
```

Evidence 标识：

- evidence id：`ev_df808fa49c6ac0b3297c097c8fee067f3f2fefbfe8fc4fbac1c6c5e1c24c4a83`
- evidence root：`363f10...`
- manifest：`agm_8455...`
- inventory：`952c82...`
- application graph：`jag_5714...`
- semantic graph：`jsrg_d318...`
- raw JSON SHA-256：`84b1df19dc1c4ba80258bcef98f469c0d2d5f2cb135ea312819d3667ed138c0d`

### 9.4 REA 的帮助与限制

REA 的帮助：

- 快速确认 TypeScript 服务中的构造、异步调用和校验函数关系；
- 给出文件/符号级 Evidence，便于回到源码核验；
- 区分 import 关系与局部 semantic relation。

REA 的限制：

- 当前命令不分析 Python，无法直接建立 `register_tool → Agent._initialize → ActionEvent → Executor → ObservationEvent` 主链；
- 目标只有两个 TypeScript 文件，结论只覆盖 Canvas 工具目录边界；
- 无法仅凭静态图连接 Canvas HTTP client 与 Python Agent Server 路由；
- semantic status 为 `unknown`，即使没有截断，也不能把全部关系视为完备；
- REA 证明的是代码关系，不证明依赖可用、工具真正注册成功或运行时权限正确。

因此本笔记把 REA 用作“定位与证据索引”，Python 执行机制以逐文件人工追踪为主。

## 10. 事实、推测、建议与未验证项

### 已确认事实

- OpenHands 有进程级 Registry 与每个 Agent 的 `tools_map` 两层工具集合；
- LLM 请求使用当前 `tools_map`，并通过 ToolDefinition 转换成 provider schema；
- Tool call 被校验为 ActionEvent，经 Executor 返回 ObservationEvent；
- ObservationEvent 以 `role="tool"` 回到下一轮 LLM 上下文；
- Terminal/File Editor 在创建时绑定 Workspace 工作目录；
- MCP 工具被包装成 ToolDefinition，进入同一 Agent 事件循环；
- 当前两个官方 submodule 在研究过程中没有被修改。

### 合理推测

- Observation 回流承担了大部分实际 reflection，但效果由模型和上下文质量决定；
- 未来新增跨语言工具时，MCP 比在 Python Registry 中直接加入专有适配更容易隔离依赖和部署。

### 主观建议

- 阅读 Tool 系统时始终区分 catalog、Agent `tools_map`、Executor 和 UI terminal；
- 调试“模型看不到工具”时按 `注册 → spec → resolve/create → filter → tools_map → LLM schema` 顺序排查；
- 调试“工具调用失败”时按 `Action 参数 → 确认/Hook → 资源锁 → Executor → Observation/ErrorEvent` 顺序排查。

### 未验证信息

- 未启动 OpenHands，未实测具体 Agent 在真实会话中最终得到的工具列表；
- 未连接实际 MCP Server，未实测 `tools/list_changed`；
- 未执行 Terminal/File/Browser/Task 工具；
- 未验证所有可选依赖、容器、远程 Runtime 和权限组合；
- MCP 对比以本地源码快照及研究日可访问的官方 SDK 文档为依据，协议和 SDK 后续版本可能继续变化。

## 11. 关键源码索引

| 主题 | 文件 | 类/函数 |
|---|---|---|
| 全局注册 | `openhands-sdk/openhands/sdk/tool/registry.py` | `register_tool`, `resolve_tool`, `list_tool_catalog` |
| Tool 规格 | `openhands-sdk/openhands/sdk/tool/spec.py` | `Tool` |
| Tool 协议 | `openhands-sdk/openhands/sdk/tool/tool.py` | `ToolDefinition`, `ToolExecutor`, `ToolAnnotations` |
| 默认工具 | `openhands-tools/openhands/tools/preset/default.py` | `register_default_tools`, `get_default_tools` |
| Agent 工具实例化 | `openhands-sdk/openhands/sdk/agent/base.py` | `_initialize`, `tools_map`, `add_runtime_tools` |
| Agent 调用 | `openhands-sdk/openhands/sdk/agent/agent.py` | `_astep`, `_get_action_event`, `_aexecute_actions`, `_execute_action_event` |
| 并发执行 | `openhands-sdk/openhands/sdk/agent/parallel_executor.py` | `ParallelToolExecutor` |
| 事件回流 | `openhands-sdk/openhands/sdk/event/llm_convertible/action.py` | `ActionEvent.to_llm_message` |
| 事件回流 | `openhands-sdk/openhands/sdk/event/llm_convertible/observation.py` | `ObservationEvent.to_llm_message` |
| Conversation 初始化 | `openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py` | `_ensure_agent_ready`, `_runtime_mcp_tools_for_agent` |
| LLM schema | `openhands-sdk/openhands/sdk/llm/llm.py` | `to_openai_tool`/`to_responses_tool` 调用点 |
| Terminal | `openhands-tools/openhands/tools/terminal/definition.py` | `TerminalTool`, `TerminalAction`, `TerminalObservation` |
| Terminal 执行 | `openhands-tools/openhands/tools/terminal/impl.py` | `TerminalExecutor` |
| File Editor | `openhands-tools/openhands/tools/file_editor/definition.py` | `FileEditorTool`, `FileEditorAction`, `FileEditorObservation` |
| File 执行 | `openhands-tools/openhands/tools/file_editor/impl.py` | `FileEditorExecutor` |
| MCP 创建 | `openhands-sdk/openhands/sdk/mcp/utils.py` | `DefaultMCPToolProvider`, `create_mcp_tools` |
| MCP 适配 | `openhands-sdk/openhands/sdk/mcp/tool.py` | `MCPToolDefinition`, `MCPToolExecutor` |
| Client Tool | `openhands-sdk/openhands/sdk/tool/client_tool.py` | `ClientToolSpec`, `ClientTool`, `ClientToolExecutor` |
| UI Client Tool | `openhands/src/api/canvas-ui-client-tool.ts` | `CANVAS_UI_CLIENT_TOOL` |
| Canvas catalog | `openhands/src/api/tool-catalog-service/tool-catalog-service.api.ts` | `ToolCatalogService.getCatalog` |
| UI catalog query | `openhands/src/hooks/query/use-tool-catalog.ts` | `useToolCatalog` |
| 独立 UI terminal | `openhands-agent-server/openhands/agent_server/bash_service.py` | Bash event service（非 Agent Tool） |

## 12. 外部参考

- MCP TypeScript SDK：<https://ts.sdk.modelcontextprotocol.io/v2/clients/calling>
- MCP Go SDK Server 文档：<https://go.sdk.modelcontextprotocol.io/server/>

外部文档只用于核对 MCP 的公开发现/调用语义；OpenHands 结论均以本地固定源码快照为主。
