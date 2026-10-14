# OpenHands Agent 执行循环

> - 研究日期：2026-10-13
> - OpenHands Canvas 快照：`2bdc0e9d6c5940bc3d4667fb2127fbb753b2f7c8`
> - Software Agent SDK 快照：`7bd668c9ab74f62c85745cd95adb503f53e7228b`

## 1. 目标、范围与前提修正

本阶段只做静态源码研究和小范围 REA 分析，没有启动 OpenHands、安装完整依赖或修改两个官方 submodule。

分析范围：

- `openhands-study/openhands`：Canvas 前端如何创建会话、发送用户消息；
- `openhands-study/software-agent-sdk`：Agent Server、Conversation、Agent、LLM、Tool、Memory 和 Workspace；
- REA：只分析 Canvas 的 TypeScript 会话服务边界。当前使用的 REA 命令不能分析 Python，所以 Python 调用链来自人工源码追踪，不冒充 REA 结论。

需要先修正一个容易产生误解的前提：当前实现并不存在一个统一的、固定按 `planning → action → observation → reflection` 顺序执行的四阶段控制器。

已确认的真实骨架是：

```text
用户消息
  → MessageEvent
  → LocalConversation.arun() 循环
  → Agent.astep()
  → LLM 返回普通文本或 tool_calls
      ├─ 普通文本 → MessageEvent → FINISHED
      └─ tool_calls → ActionEvent → Tool → ObservationEvent
                                      ↓
                         下一次 astep() 重新读取事件历史
```

因此：

- `action` 和 `observation` 是明确的事件类型和循环边界；
- `planning` 主要通过 Prompt、专用 Planning Agent/工具和模型行为实现，不是每轮必经的硬编码状态；
- `reflection` 主要发生在模型读取上一轮 Observation 后的下一次推理，也可由 `ThinkTool` 或可选 Critic 增强；源码中没有发现全局统一的 `Reflection` 阶段。

## 2. 用户请求进入系统后的调用链

### 2.1 新会话的第一条请求

Canvas 将“创建会话”和第一条用户消息一起提交：

```text
openhands/src/hooks/mutation/use-create-conversation.ts
  useCreateConversation mutation
    → AgentServerConversationService.createConversation(...)

openhands/src/api/conversation-service/agent-server-conversation-service.api.ts
  AgentServerConversationService.createConversation()
    → ConversationClient.createConversation(...)

software-agent-sdk/openhands-agent-server/.../conversation_router.py
  start_conversation()
    → ConversationService.start_conversation()

software-agent-sdk/openhands-agent-server/.../conversation_service.py
  ConversationService.start_conversation()
    → _start_conversation()
    → _create_conversation()
    → _start_event_service()
    → EventService.start()
    → EventService.send_message(initial_message, False)
    → EventService.run()
```

`_create_conversation()` 同时解析 Agent、Workspace、工具、插件、LLM 配置和持久化状态。`EventService.start()` 随后创建 `LocalConversation`，将这些对象接入同一个会话运行时。

### 2.2 已有会话中的后续消息

正常在线路径优先使用 WebSocket：

```text
openhands/src/hooks/use-send-message.ts
  useSendMessage().send()
    → ConversationWebSocketContext.sendMessage()

openhands/src/contexts/conversation-websocket-context.tsx
  sendMessage()
    → currentSocket.send(JSON.stringify({ ...message, run: true }))

software-agent-sdk/openhands-agent-server/.../sockets.py
  events_socket()
    → Message.model_validate(data)
    → EventService.send_message(message, True)
```

WebSocket 未连接时，Canvas 会回退到 REST 队列：

```text
ConversationWebSocketContext.sendMessage()
  → ConversationClient.sendEvent(..., { run: true })
  → event_router.send_message()
  → EventService.send_message(message, request.run)
```

带附件的辅助路径也调用 `AgentServerConversationService.sendMessage()`，最终仍通过 `ConversationClient.sendEvent(..., { run: true })` 进入同一 EventService。

### 2.3 服务端统一入口

关键文件：`software-agent-sdk/openhands-agent-server/openhands/agent_server/event_service.py`

- `EventService.send_message()`：把网络请求转交给 `LocalConversation.send_message()`；`run=True` 时继续调用 `EventService.run()`；
- `EventService.run()`：处理并发运行额度、会话锁和后台任务；原生异步 Agent 进入 `LocalConversation.arun()`，其他实现可走同步 `LocalConversation.run()`；
- `EventService.start()`：恢复或创建 Agent、Workspace、事件历史和 `LocalConversation`。

关键文件：`software-agent-sdk/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py`

- `LocalConversation.send_message()`：只接受 user role，必要时重置已结束状态，追加技能上下文，生成 `MessageEvent`；
- `_default_callback()`：先把每个事件追加到会话状态，再允许发布给外部订阅者；这使事件历史成为运行循环的事实记录；
- `LocalConversation.arun()` / `_arun()`：执行循环、迭代上限、预算、取消、卡死检测、确认流程和终态判断；
- `_arun()` 内调用 `await self.agent.astep(...)` 完成一轮 Agent 决策。

## 3. Agent 核心循环

### 3.1 真实的一轮执行

- 核心类：`openhands.sdk.agent.agent.Agent`
- 核心方法：`Agent.astep()`、`Agent._astep()`

每轮顺序如下：

1. 检查是否存在等待确认后尚未执行的 Action；有则先执行，不再调用 LLM。
2. 获取 LLM 调用上下文和模型运行时元数据。
3. 由 `aprepare_llm_messages()` 从 `ConversationState.view` 生成消息；必要时先产生 `Condensation`，本轮暂不调用 LLM。
4. 调用 `self.llm.agenerate(messages=..., tools=...)`。
5. `classify_response()` 将返回分成 `TOOL_CALLS`、`CONTENT`、`REASONING_ONLY` 或 `EMPTY`。
6. Tool call 被转换成 Action 并执行；普通内容则形成 Agent 的 `MessageEvent` 并结束本次运行。
7. Action 对应的 Observation 被追加到事件历史，`LocalConversation._arun()` 再进入下一轮 `Agent.astep()`。

### 3.2 Planning

Planning 有两种主要形态，但都不是通用循环中的固定状态。

第一种是 Agent 在普通 LLM 推理中自行形成计划。`PlanningSection` 把 Initial Understanding、Planning、Synthesis、Refinement 等指导写进 Prompt，模型可以在一次或多次 LLM 调用中执行这些认知步骤。

相关文件与对象：

- `openhands-sdk/openhands/sdk/context/prompts/sections/planning.py`
  - `PlanningSection`
- `openhands-tools/openhands/tools/preset/planning.py`
  - `get_planning_tools()`
  - `get_planning_condenser()`
  - `get_planning_agent()`

第二种是 Canvas 的 plan mode。Canvas 将消息路由到独立的 `planningConversationId`；`get_planning_agent()` 仍然构造标准 `Agent`，但使用规划 Prompt、规划 condenser，以及 Glob、Grep、PlanningFileEditor 等受限工具。也就是说，Planning Agent 是“特殊配置的同类 Agent”，不是主 Agent 内部的 `Planner.step()` 子系统。

### 3.3 Action

关键调用链：

```text
Agent._astep()
  → classify_response(message)
  → ResponseDispatchMixin._ahandle_tool_calls()
  → Agent._get_action_event()
  → Agent._aexecute_actions()
  → _ActionBatch.aprepare()
  → ParallelToolExecutor.aexecute_batch()
```

`Agent._get_action_event()` 负责：

- 解析 tool call JSON；
- 规范化工具别名和参数；
- 在 `tools_map` 中解析 `ToolDefinition`；
- 用 Pydantic Action 类型校验参数；
- 计算安全风险、摘要和可选 Critic 结果；
- 创建并发布 `ActionEvent`。

`_ActionBatch` 会在 Finish Action 后截断无效动作、处理被确认策略阻止的动作，并把可执行动作交给 `ParallelToolExecutor`。并行执行器通过工具声明的资源锁避免对同一资源无序并发；最终事件仍按原 Action 顺序发布。

### 3.4 Observation

关键方法：`Agent._execute_action_event()`

```text
ToolDefinition(action, conversation)
  → ToolExecutor 执行具体操作
  → Observation
  → ObservationEvent(action_id, tool_name, tool_call_id)
  → LocalConversation._on_event()
  → ConversationState.append_event()
  → 下一轮 Agent.astep() 的 View
```

工具必须返回 `Observation`。参数或执行错误会转换成 Agent 可见的错误事件，使下一轮模型有机会纠正，而不是把异常直接伪装成成功结果。

这条 Observation 回流链是 OpenHands 循环的关键：模型不是直接读取“工具返回值变量”，而是下一轮从持久化事件历史的 View 中重新看到工具结果。

### 3.5 Reflection

已确认：没有找到所有 Agent 每轮必经的 `Reflection` 类、状态或调度函数。

可以把以下三个机制理解为不同强度的 reflection：

1. **隐式反思**：ObservationEvent 进入下一轮上下文，LLM 根据结果决定继续、修正或结束。这是默认且最主要的反思方式。
2. **显式思考工具**：`openhands-sdk/openhands/sdk/tool/builtins/think.py` 中的 `ThinkTool` / `ThinkExecutor` 允许模型记录一段 thought；它不修改 Workspace，也不提供新外部信息。
3. **可选 Critic**：`CriticMixin._evaluate_with_critic()` 和 `_check_iterative_refinement()` 可在配置 Critic 时评价 Action/结果，并在完成质量不足时触发继续改进。它不是默认通用阶段。

所以，将整个系统描述为 “plan-act-observe-reflect” 是有帮助的概念模型，但不能把它当成源码中的四个固定函数。

## 4. LLM 调用位置

主调用链：

```text
LocalConversation._arun()
  → Agent.astep()
  → Agent._astep()
  → aprepare_llm_messages(state.view, condenser, llm)
  → LLM.agenerate(messages, tools, ...)
      ├─ LLM.aresponses()   # Responses API 路径
      └─ LLM.acompletion()  # Chat completion 路径
          → LLM._atransport_call()
          → LiteLLM/provider transport
```

对应文件：

- `openhands-sdk/openhands/sdk/agent/agent.py`
  - `Agent._astep()`：调用 `self.llm.agenerate()`，随后分派响应；
- `openhands-sdk/openhands/sdk/agent/utils.py`
  - `aprepare_llm_messages()`：从 View 形成消息，执行上下文压缩；
- `openhands-sdk/openhands/sdk/llm/llm.py`
  - `LLM.agenerate()`：在 Responses API 与 completion 路径间路由；
  - `LLM.aresponses()` / `LLM.acompletion()`：准备模型请求；
  - `LLM._atransport_call()`：实际传输边界。

一个重要并发细节：`Agent._astep()` 在等待 LLM 网络响应时临时释放会话状态锁，使新消息和状态快照不必被整个模型响应时间阻塞；模型结果回来后继续在循环中处理。

## 5. Tool 调用机制

OpenHands 的工具不是简单的“函数名字符串”，而是一组类型化契约：

- `ToolDefinition`：工具名称、说明、参数 schema、Action 类型、Observation 类型和执行器创建逻辑；
- `Action`：经过验证的模型调用参数；
- `ToolExecutor`：执行 Action；
- `Observation`：结构化结果；
- `ActionEvent` / `ObservationEvent`：把调用及结果接入会话历史。

工具在传给 LLM 时提供 schema；模型返回 tool call 后，`normalize_tool_call()`、`fix_malformed_tool_arguments()` 和 `action_from_arguments()` 共同完成兼容、修复与严格验证。工具不存在或参数无效会形成可见错误事件。

工具可以得到 `conversation`，因此可访问 ConversationState、Workspace、Secrets 或模型切换等会话能力。确认策略和 SecurityAnalyzer 在执行前提供额外控制；工具声明资源后，`ParallelToolExecutor` 可安全调度多个调用。

## 6. Memory 机制

这里至少有三种不同含义的“记忆”，不能混为一个组件。

### 6.1 当前会话的工作记忆

`ConversationState` 持有事件历史，`state.view` 是为 Agent 增量维护的上下文视图。MessageEvent、ActionEvent、ObservationEvent、Condensation 等共同构成下一次 LLM 调用可见的历史。

`aprepare_llm_messages()` 会把 View 中可转换的事件变成 LLM 消息；Condenser 在上下文过长时压缩历史。它是上下文管理，不是向量数据库式长期记忆。

### 6.2 用户级与项目级持久记忆

文件：`openhands-sdk/openhands/sdk/context/memory.py`

`load_memory()` 在第一次 `send_message()` / `run()` 时读取：

```text
~/.openhands/memory/MEMORY.md
<workspace>/.openhands/memory/MEMORY.md
```

已确认行为：

- 用户级在前，项目级在后；
- 默认合计字符预算为 `6000`；
- 超预算时从各 tier 顶部按整行裁剪，保留较新的尾部；
- 同目录每日文件 `YYYY-MM-DD.md` 不自动加载，需要 Agent 按需读取；
- 失败是 best-effort，不阻止会话启动。

`LocalConversation._ensure_plugins_loaded()` 取得 Workspace 路径后调用 `load_memory()`，写入 `AgentContext.memory_context`；`MemoryContextSection` 再把内容放入 Prompt，并明确提示模型把它视为可能过期、未经验证的上下文。

### 6.3 持久化存储不等于 Agent Memory

某些名为 memory 的 FileStore/内存实现只是状态存储后端。它们解决“数据保存在哪里”，不等于 Agent 如何回忆、筛选和使用知识。

## 7. Workspace 如何参与执行

Workspace 是 Agent 与目标项目/执行环境之间的边界对象。

关键路径：

- `openhands-sdk/openhands/sdk/workspace/base.py`
  - `BaseWorkspace`
  - `execute_command()`、`file_upload()`、`file_download()`、`git_changes()`、`git_diff()`、`pause()`、`resume()`；
- `openhands-sdk/openhands/sdk/workspace/local.py`
  - `LocalWorkspace`：本机目录实现；
- `openhands-agent-server/openhands/agent_server/conversation_service.py`
  - `ConversationService._create_conversation()`：选择或创建 Workspace；
- `openhands-agent-server/openhands/agent_server/event_service.py`
  - `EventService.start()`：把 Workspace 注入 `LocalConversation`；
- `openhands-tools/openhands/tools/terminal/definition.py`
  - `TerminalTool.create()`：读取 `conv_state.workspace.working_dir` 并构造 TerminalExecutor；
- `openhands-tools/openhands/tools/terminal/impl.py`
  - `TerminalExecutor`：在对应工作目录中维护终端会话并执行命令。

参与方式：

1. Workspace 的 `working_dir` 决定 Agent 面向哪个项目目录；
2. 项目级 Skills、Rules 和 `.openhands/memory/MEMORY.md` 都依赖该路径加载；
3. Terminal、文件和 Git 工具通过 Workspace 或其工作目录产生副作用；
4. Workspace 生命周期可随会话暂停、恢复、关闭；
5. 工具输出被包装为 ObservationEvent，再反馈给 LLM。

需要注意：内置 TerminalTool 并非每次命令都直接调用 `BaseWorkspace.execute_command()`；它从 Workspace 取得 `working_dir` 后建立自己的终端后端。其他本地/远程工具可能使用不同 Workspace 接口。因此，Workspace 是统一的环境边界，但不是所有工具都共享同一条具体执行函数。

## 8. REA 对关键文件关系的分析

### 8.1 执行范围与结果

固定使用：

- Node.js `v24.18.0`；
- REA npm 发布版 `rea-agents@6.4.0`；
- 目标：`openhands-study/openhands/src/api/conversation-service`；
- 命令：`analyze-javascript-application <target> --json`。

先尝试了当前 REA 源码 CLI，但 Windows 原生控制清单 `native/windows/build/manifest.json` 不存在，命令以 `capability_unavailable`、退出码 `1` 停止。随后使用已固定的 npm 发布版完成分析，退出码为 `0`。这不是 OpenHands 问题。

成功结果：

| 指标 | 值 |
| --- | ---: |
| 解析的 JavaScript/TypeScript 文件 | `3` |
| parse failures | `0` |
| AST 节点访问量 | `4,925` |
| findings | `127` |
| 应用图节点 / 边 | `83` / `133` |
| 语义图节点 / 关系 | `2,603` / `2,172` |
| Evidence ID | `ev_5a4fc6adb7f823bce2d87d59e31bbdccf148195ccfc289b25d0b18e45feaf0bc` |
| 应用图 ID | `jag_1c41750da255c79740127e6886745ae9547e044aa95dce11801ef232f25dc052` |
| 语义图 ID | `jsrg_43d1c34fcf8eb09dae50e1a3e8411490e5180fe6f563fc98e38ccc846c7ce6a6` |
| 原始 JSON SHA-256 | `078814a3b2add9986c80b8d5a1cb5c1e22d44ae5f74f39b7d13ad85dc9ca8f96` |

原始输出位于被 `.gitignore` 排除的 `openhands-study/rea-analysis/raw-output/`，不作为学习笔记提交内容。

### 8.2 REA 确认的 Canvas 关系

REA 在 `agent-server-conversation-service.api.ts` 中定位到：

- `AgentServerConversationService.sendMessage()`：源码范围 474–509；
- `sendMessage()` 内对 `sendEvent` 属性的读取/调用位置：502–504；
- `AgentServerConversationService.createConversation()`：源码范围 511–670；
- `createConversation()` 内对客户端 `createConversation` 的读取/调用位置：629–631。

结合人工阅读，可还原为：

```text
AgentServerConversationService.sendMessage()
  → new ConversationClient(...).sendEvent(..., { run: true })

AgentServerConversationService.createConversation()
  → new ConversationClient(...).createConversation(...)
```

REA 的价值在于提供了可复核的文件范围、函数节点、属性访问位置、import 图和 Evidence 标识；人工阅读负责解释这些节点在产品流程中的含义。

### 8.3 REA 限制

本次应用图 coverage 为 `complete` 且未截断，但语义图 coverage 为 `unknown`，各语义 family 为 partial：

- call-flow：保留 `211` 条关系，`197` 个 unknown；
- data-flow：保留 `1,535` 条关系，`289` 个 unknown；
- object-flow：保留 `138` 条关系，`238` 个 unknown；
- promise-ownership：保留 `49` 条关系，`46` 个 unknown。

所以不能把“应用图完整”误读为“所有调用都已解析”。特别是：

- `ConversationClient` 实现在目标目录外，跨边界调用不能由这次小范围图完整解析；
- Canvas 到 Agent Server 是网络协议边界，静态 TypeScript import 图不会直接连接 Python 函数；
- 当前命令不分析 Python，因此 `EventService → LocalConversation → Agent → LLM/Tool` 全链必须人工核对；
- 静态关系证明“代码存在且可形成该连接”，不证明某一运行时分支一定实际执行。

## 9. 关键文件阅读地图

| 层 | 文件 | 类 / 函数 | 人工解释 |
| --- | --- | --- | --- |
| Canvas 输入 | `openhands/src/hooks/use-send-message.ts` | `useSendMessage()` | 把聊天输入转换为 user message |
| Canvas 传输 | `openhands/src/contexts/conversation-websocket-context.tsx` | `sendMessage()` | 优先 WebSocket，断线回退 REST；设置 `run: true` |
| Canvas 会话 API | `openhands/src/api/conversation-service/agent-server-conversation-service.api.ts` | `AgentServerConversationService` | 会话创建和 REST 消息边界 |
| WebSocket 入口 | `software-agent-sdk/openhands-agent-server/openhands/agent_server/sockets.py` | `events_socket()` | 验证消息并进入 EventService |
| REST 入口 | `software-agent-sdk/openhands-agent-server/openhands/agent_server/event_router.py` | `send_message()` | REST sendEvent 的服务端入口 |
| 会话创建 | `software-agent-sdk/openhands-agent-server/openhands/agent_server/conversation_service.py` | `ConversationService._create_conversation()` | 组装 Agent、Workspace 和事件服务 |
| 运行桥接 | `software-agent-sdk/openhands-agent-server/openhands/agent_server/event_service.py` | `EventService.start()/send_message()/run()` | 网络服务与 SDK 会话循环的桥梁 |
| 循环控制 | `software-agent-sdk/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py` | `LocalConversation._arun()` | 迭代、预算、状态、确认和停止条件 |
| Agent 决策 | `software-agent-sdk/openhands-sdk/openhands/sdk/agent/agent.py` | `Agent._astep()` | 准备上下文、调用 LLM、分派结果 |
| 响应分派 | `software-agent-sdk/openhands-sdk/openhands/sdk/agent/response_dispatch.py` | `classify_response()`、`_ahandle_tool_calls()` | 区分 tool call 和最终文本 |
| Tool 执行 | `software-agent-sdk/openhands-sdk/openhands/sdk/agent/agent.py` | `_get_action_event()`、`_execute_action_event()` | Tool call → ActionEvent → ObservationEvent |
| 并行工具 | `software-agent-sdk/openhands-sdk/openhands/sdk/agent/parallel_executor.py` | `ParallelToolExecutor` | 资源锁、并发执行和取消 |
| LLM | `software-agent-sdk/openhands-sdk/openhands/sdk/llm/llm.py` | `LLM.agenerate()`、`_atransport_call()` | 模型请求路由与传输边界 |
| Planning | `software-agent-sdk/openhands-tools/openhands/tools/preset/planning.py` | `get_planning_agent()` | 构造专用规划 Agent |
| Reflection 辅助 | `software-agent-sdk/openhands-sdk/openhands/sdk/agent/critic_mixin.py` | `CriticMixin` | 可选评价与迭代改进 |
| Memory | `software-agent-sdk/openhands-sdk/openhands/sdk/context/memory.py` | `load_memory()` | 加载用户级和项目级 MEMORY.md |
| Workspace | `software-agent-sdk/openhands-sdk/openhands/sdk/workspace/base.py` | `BaseWorkspace` | 项目与执行环境的抽象边界 |
| Terminal | `software-agent-sdk/openhands-tools/openhands/tools/terminal/definition.py` | `TerminalTool.create()` | 将 Workspace 工作目录注入终端执行器 |

## 10. 结论分级

### 已确认事实

- 用户消息最终进入 `EventService.send_message()`，并由 `LocalConversation` 记录为 `MessageEvent`；
- 原生异步循环由 `LocalConversation._arun()` 重复调用 `Agent.astep()`；
- LLM tool call 被转换为 `ActionEvent`，工具结果被转换为 `ObservationEvent`；
- Observation 进入事件历史并成为下一轮 LLM 上下文；
- Planning 是 Prompt/专用 Agent/工具配置，不是统一硬编码阶段；
- Workspace、持久 Memory、会话事件历史分别承担不同职责；
- 两个官方 submodule 在研究前后都未被修改。

### 合理推测

- 从认知模型看，下一轮 LLM 对 Observation 的处理可称为 reflection；这是对行为的解释，不是源码中的独立阶段名。
- Planning Agent 与主 Agent 使用相同核心类，表明 OpenHands 更偏向“配置和工具决定角色”，而不是为每种角色复制一套循环。

### 未验证信息

- 未启动完整环境，因此没有验证实际模型提供商、远程 Workspace、Cloud 后端和 Docker runtime 的运行时差异；
- 未做动态 tracing，不能给出一次真实请求中每个分支的耗时、顺序和是否命中；
- REA 没有覆盖 Python 核心，也没有证明网络两端在某次运行中实际连通。

### 主观建议

下一阶段若要继续深入，优先做一个受控的“单工具调用”动态实验：让 Agent 只读取一个测试文件，保存 MessageEvent、ActionEvent、ObservationEvent 和最终 MessageEvent 的时间序列。这样能以最小运行成本验证本笔记的静态调用链，同时避免直接启动复杂项目任务。
