# OpenHands Memory 与状态管理机制

> - 研究日期：2026-10-13
> - OpenHands Canvas 快照：`2bdc0e9d6c5940bc3d4667fb2127fbb753b2f7c8`
> - Software Agent SDK 快照：`7bd668c9ab74f62c85745cd95adb503f53e7228b`

## 1. 目标、范围与前提修正

本阶段只进行静态源码阅读、REA TypeScript 分析和官方 MCP 文档核对，没有启动 OpenHands 完整环境、安装完整依赖或修改两个官方 submodule。

“OpenHands Memory”不是一个单一对象。当前源码至少包含四种不同层次：

1. **当前 LLM 上下文**：活动分支上的 `View`，包含可以转换为 LLM Message 的事件；
2. **会话历史**：追加写入的 `EventLog`，保存 Message、Action、Observation、Condensation 等事件；
3. **结构化会话状态**：`ConversationState`，保存执行状态、Agent、Workspace、分支 HEAD、统计、Agent 私有状态等；
4. **跨会话持久记忆**：可选的两层 `MEMORY.md`，在新会话启动时注入系统提示。

还需要纠正两个名称上的误导：

- `openhands/sdk/io/memory.py` 中的 `InMemoryFileStore` 是内存文件存储后端，不是 Agent 长期记忆模块；
- “short-term memory”和“long-term memory”适合作为分析术语，但当前源码没有名为 `ShortTermMemory` 或统一 `LongTermMemory` 的类。

## 2. Memory 与状态模块位置

### 2.1 跨会话持久记忆

| 文件 | 类/函数 | 作用 |
|---|---|---|
| `openhands-sdk/openhands/sdk/context/memory.py` | `load_memory()` | 读取用户级和项目级 `MEMORY.md` |
| `openhands-sdk/openhands/sdk/context/agent_context.py` | `AgentContext.load_memory`, `memory_context` | 控制是否启用，并暂存已解析文本 |
| `openhands-sdk/openhands/sdk/context/prompts/sections/static.py` | `MemorySection` | 告诉 Agent 如何维护两层记忆 |
| `openhands-sdk/openhands/sdk/context/prompts/sections/dynamic.py` | `MemoryContextSection` | 将记忆包装为 `<MEMORY_CONTEXT>`，并标记为不可信内容 |
| `openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py` | `_ensure_plugins_loaded()` | Workspace 已知后延迟加载记忆 |
| `examples/01_standalone_sdk/55_persistent_memory.py` | 示例 | 展示两个独立 Conversation 共享项目记忆 |

两层路径：

```text
用户级：~/.openhands/memory/MEMORY.md
        或 OH_PERSISTENCE_DIR/memory/MEMORY.md

项目级：<workspace>/.openhands/memory/MEMORY.md
```

每层还可包含 `YYYY-MM-DD.md` 日记，但日记不会自动载入；只有索引 `MEMORY.md` 自动进入 Prompt，Agent 需要按索引提示再通过文件工具读取日记。

### 2.2 会话历史和结构化状态

| 文件 | 类/函数 | 作用 |
|---|---|---|
| `openhands-sdk/openhands/sdk/conversation/state.py` | `ConversationState` | 会话的结构化、可持久化状态 |
| 同上 | `create()`, `_save_base_state()`, `append_event()` | 创建/恢复、保存快照、追加事件 |
| `openhands-sdk/openhands/sdk/conversation/event_store.py` | `EventLog` | 文件支持的追加式事件日志 |
| `openhands-sdk/openhands/sdk/conversation/persistence_const.py` | `BASE_STATE`, `EVENTS_DIR` | 定义 `base_state.json` 和 `events/` |
| `openhands-sdk/openhands/sdk/event/conversation_state.py` | `ConversationStateUpdateEvent` | 将状态变化同步给远程客户端 |
| `openhands-sdk/openhands/sdk/context/view/view.py` | `View` | 从事件历史投影出当前 LLM 可见历史 |
| `openhands-sdk/openhands/sdk/context/condenser/` | Condenser 系列 | 压缩当前 LLM 上下文 |

### 2.3 Agent 读取历史的入口

| 文件 | 类/函数 | 作用 |
|---|---|---|
| `openhands-sdk/openhands/sdk/agent/agent.py` | `Agent._astep()` | 每轮从 `state.view` 准备 LLM 输入 |
| `openhands-sdk/openhands/sdk/agent/utils.py` | `aprepare_llm_messages()` | 调用 condenser 并把事件转换成消息 |
| `openhands-sdk/openhands/sdk/event/base.py` | `LLMConvertibleEvent.events_to_messages()` | 聚合可发送给模型的消息 |
| `openhands-sdk/openhands/sdk/event/condenser.py` | `Condensation.apply()` | 从 View 中移除旧事件并插入摘要 |

## 3. Agent 如何读取历史信息

### 3.1 用户消息进入 EventLog

```text
LocalConversation.send_message()
  → 创建 MessageEvent(source="user")
  → LocalConversation._on_event(...)
  → _default_callback(event)
  → ConversationState.append_event(event)
  → EventLog.append(event)
  → events/event-<序号>-<event-id>.json
```

`LocalConversation` 构造时建立默认 callback。源码明确保证 `_default_callback` 先持久化事件，再调用外部订阅者，避免客户端收到“尚未落盘”的事件。

`ConversationState.append_event()` 同时：

- 为事件补上当前 `parent_id`；
- 把事件追加到 `EventLog`；
- 将 `leaf_event_id` 移到新事件，形成新的活动 HEAD。

因此历史已经不是单纯线性数组，而是可导航、可分叉的事件树；`active_branch()` 只返回当前 HEAD 到根的分支，放弃的分支仍可留在磁盘上。

### 3.2 每轮构造 LLM 上下文

```text
Agent._astep(conversation)
  → state.view
  → aprepare_llm_messages(view, condenser, llm)
      → condenser.acondense(view)
      → View.events
      → LLMConvertibleEvent.events_to_messages(...)
  → LLM.agenerate(messages=...)
```

`ConversationState.view` 是活动分支的缓存投影：

- 线性追加时只回放新增尾部，避免每轮扫描整个日志；
- 切换分支、冷加载或恢复错误时调用 `View.from_events()` 重建；
- 非 `LLMConvertibleEvent` 的内部状态事件不会进入模型上下文；
- `Condensation` 会改变 View，但不会物理删除 EventLog 中的旧事件。

这一区分非常重要：

```text
EventLog = 完整、追加式审计历史
View     = 当前活动分支上，本轮 LLM 实际能看到的历史
```

### 3.3 历史事件如何变成消息

典型映射：

- `MessageEvent` → `user` 或 `assistant` message；
- `ActionEvent` → 带 `tool_calls` 的 `assistant` message；
- `ObservationEvent` → 带 `tool_call_id` 的 `tool` message；
- `CondensationSummaryEvent` → 包含摘要的 `user` message；
- `ConversationStateUpdateEvent`、`PauseEvent` 等内部事件 → 不进入 View。

所以 Agent 读取的不只是用户与助手文本，还包括工具调用、执行结果、错误和压缩摘要。

## 4. ConversationState 如何保存

### 4.1 两类持久化文件

当 `persistence_dir` 有值时，每个 Conversation 使用独立目录：

```text
<persistence_base>/<conversation-id>/
├── base_state.json
└── events/
    ├── event-00000-<event-id>.json
    ├── event-00001-<event-id>.json
    └── ...
```

`base_state.json` 保存结构化快照，事件则分别写入 `events/`。这样避免每次新增事件都重写完整历史。

若没有 `persistence_dir` 和外部 `FileStore`，`ConversationState.create()` 会退回 `InMemoryFileStore`；此时进程结束后不会保留会话。

### 4.2 ConversationState 的主要字段

| 字段 | 作用 |
|---|---|
| `id` | Conversation ID |
| `agent` | 可恢复的 Agent 配置，是恢复时的重要事实来源 |
| `workspace` | 当前执行 Workspace |
| `execution_status` | idle/running/paused/finished/error/stuck 等 |
| `confirmation_policy` | 工具确认策略 |
| `activated_knowledge_skills` | 已激活知识技能，避免重复注入 |
| `invoked_skills` | 已显式调用的渐进披露 Skill |
| `blocked_actions`, `blocked_messages` | Hook 拦截状态 |
| `last_user_message_id` | 最近用户消息定位 |
| `leaf_event_id`, `head_is_empty` | 当前事件树 HEAD |
| `stats` | LLM 使用与成本统计 |
| `secret_registry` | 敏感信息注册表 |
| `agent_state` | Agent 自定义的跨迭代结构化状态 |
| `hook_config` | Conversation Hook 配置 |

`agent_state` 是普通字典，适合保存 ACP session id、Critic 迭代次数等 Agent 专用数据。源码要求通过重新赋值触发自动保存，例如：

```python
state.agent_state = {**state.agent_state, key: value}
```

它不是自然语言记忆，也不会自动发送给 LLM；是否影响 Agent 取决于具体 Agent 是否读取该键。

### 4.3 自动保存与恢复

`ConversationState.__setattr__()` 会在公开字段变化时触发 `_save_base_state()`。在 `with state:` 内发生的多次变化会标为 dirty，退出锁时只写一次快照。

恢复链：

```text
LocalConversation.__init__()
  → ConversationState.create(...)
  → FileStore.read("base_state.json")
      ├─ 存在 → model_validate() 恢复状态
      │          → EventLog(file_store, "events")
      │          → rebuild_view()
      │          → 校验/采用持久化 Agent
      └─ 不存在 → 创建新状态
                 → 写初始 base_state.json
```

敏感信息有额外处理：配置 Cipher 时加密；没有 Cipher 时保存会遮蔽 Secret，并警告这些值恢复后会丢失。

### 4.4 远程 TypeScript 客户端的状态镜像

TypeScript 端不是权威状态存储，而是 Agent Server 的客户端镜像：

```text
RemoteConversation.state
  → new RemoteState(HttpClient, conversationId)
  → new RemoteEventsList(...)

RemoteConversation.startWebSocketClient()
  → combinedCallback(event)
      → state.events.addEvent(event)
      → state.createStateUpdateCallback()(event)
      → 用户 callback(event)
```

`RemoteState`：

- 通过 `GET /api/conversations/<id>` 拉取权威状态；
- 使用 2 秒本地缓存和 `AsyncLock`；
- 收到 `ConversationStateUpdateEvent` 时更新缓存；
- 禁止客户端直接设置服务端 execution status。

`RemoteEventsList`：

- WebSocket 新事件进入本地去重缓存；
- `search()`/`getEvents()` 通过 REST 获取历史事件；
- `getEvents()` 合并服务端历史和本地尚未出现于服务端结果的事件。

底层 `ConversationEventStream` 本身明确“不保留消息历史”，只转发每个 WebSocket frame；真正历史仍在服务端 EventLog，客户端缓存只是便利层。

## 5. Short-term memory 与长期记忆

以下分类是对源码机制的分析，不是官方类名：

| 层次 | 典型实现 | 生命周期 | 是否自动进入 LLM | 主要用途 |
|---|---|---|---|---|
| 工作记忆 | `ConversationState.view` | 当前 Conversation 的当前活动分支 | 是 | 维持当前任务连续性 |
| 压缩记忆 | `CondensationSummaryEvent` | 当前 Conversation，可随再次压缩而变化 | 是 | 控制上下文长度并保留摘要 |
| 会话持久历史 | `EventLog` | 同一 Conversation 可跨进程恢复 | 经 View 筛选后进入 | 审计、恢复、分支、调试 |
| 结构化运行状态 | `ConversationState` / `agent_state` | 同一 Conversation 可恢复 | 通常不直接作为消息 | 控制运行、确认、统计和 Agent 内部状态 |
| 项目长期记忆 | `<workspace>/.openhands/memory/MEMORY.md` | 同一 Workspace 的新 Conversation | 启用后注入系统提示 | 项目决策、环境规律、昂贵经验 |
| 用户长期记忆 | `~/.openhands/memory/MEMORY.md` | 跨 Workspace、跨 Conversation | 启用后注入系统提示 | 用户偏好和通用经验 |
| 长期细节日志 | `YYYY-MM-DD.md` | 文件存在期间 | 否，需按需读取 | 保存长细节，避免索引膨胀 |

### 5.1 Persistent Memory 的具体行为

`AgentContext.load_memory` 默认是 `False`，需要显式启用。启用后的链条：

```text
AgentContext(load_memory=True)
  → LocalConversation._ensure_agent_ready()
  → _ensure_plugins_loaded()
  → load_memory(workspace.working_dir)
      → 读取用户 MEMORY.md
      → 读取项目 MEMORY.md
      → 用户层在前，项目层在后
      → 合计默认 6000 字符预算
  → AgentContext.memory_context
  → Agent.init_state()
  → Agent.get_dynamic_context()
  → MemoryContextSection.render()
  → SystemPromptEvent.dynamic_context
  → <MEMORY_CONTEXT>...</MEMORY_CONTEXT>
```

超出预算时会按层分配预算，从顶部按完整行截断，保留更靠后的内容，并加 `[earlier memory truncated]`。项目层排在用户层之后，源码注释认为靠后位置可得到更多模型注意力。

### 5.2 它不是什么

当前内建 Persistent Memory 不是：

- 向量数据库；
- embedding 相似度检索；
- 自动实体图谱；
- 自动从每轮历史提取事实的后台服务；
- 自动验证事实真伪的知识库。

系统主要通过 `MemorySection` 指示 Agent 使用已有文件工具维护 `MEMORY.md` 和日记。是否写入、写入质量、去重和过期清理仍依赖 Agent 行为。

`MemoryContextSection` 明确提醒模型：磁盘中的 Memory 可能由任何有 Workspace 权限的人修改，内容未经 OpenHands 验证，可能过期或含 Prompt Injection，不能当作权威指令。

## 6. Condenser：短期上下文的压缩

核心文件：

- `openhands-sdk/openhands/sdk/context/condenser/base.py`
- `openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py`
- `openhands-sdk/openhands/sdk/event/condenser.py`
- `openhands-sdk/openhands/sdk/context/view/view.py`

`LLMSummarizingCondenser` 默认按事件数或 Token 压力判断是否压缩，也响应显式 `CondensationRequest`。其基本策略是保留前部少量关键事件和较新的后半段，将中间旧事件总结为 `Condensation`。

```text
View 超过 max_size/max_tokens，或收到 CondensationRequest
  → LLMSummarizingCondenser.acondense()
  → 用独立/配置的 LLM 总结待遗忘事件
  → Condensation(forgotten_event_ids, summary, summary_offset)
  → 作为新事件追加到 EventLog
  → View.append_event(Condensation)
  → Condensation.apply(current_view)
  → 移除旧事件并插入 CondensationSummaryEvent
```

**已确认事实：**“遗忘”发生在 LLM View，不是从追加式 EventLog 物理删除原始事件。因此完整审计历史和模型当前上下文可以不同。

**风险：**摘要是有损压缩，可能遗漏细节或引入概括误差；后续摘要还可能总结更早的摘要。它解决的是上下文窗口问题，不等于高可信长期记忆。

## 7. Memory 如何影响下一轮 LLM 决策

下一轮决策同时受四条路径影响：

```text
Persistent MEMORY.md
  → SystemPromptEvent.dynamic_context
  → 作为高层背景影响整个会话

当前活动分支事件
  → state.view
  → Message/Action/Observation messages
  → 告诉模型刚才发生了什么

Condensation
  → 用摘要替换 View 中较旧事件
  → 改变模型保留/遗忘的细节

ConversationState
  → execution status / confirmation / blocked actions / agent_state
  → 控制是否执行、暂停、确认或恢复
```

需要区分直接影响和间接影响：

- `MessageEvent`、工具 Observation、Memory Context 和 Condensation Summary 会作为文本/消息直接影响 LLM；
- `execution_status`、`confirmation_policy`、`agent_state` 等通常由代码读取，先影响控制流，再间接改变 LLM 能执行或看到的内容；
- Workspace 文件不会自动全部进入上下文，Agent 需要用 Tool 主动读取。

## 8. 与普通 Chat History 的区别

| 维度 | 普通 Chat History | OpenHands Memory/State |
|---|---|---|
| 主要内容 | user/assistant 文本 | 消息、Tool Action、Observation、错误、状态、压缩和分支 |
| 结构 | 通常线性消息数组 | 追加式事件日志 + 可移动 HEAD 的事件树 |
| LLM 可见范围 | 通常直接截断或整段发送 | 从活动分支生成 View，再经过 condenser |
| 工具配对 | 可能仅展示文本 | 保存 tool call id、Action 和 Observation 配对 |
| 状态控制 | 常与历史混在一起或无结构 | `ConversationState` 单独保存运行/确认/Agent 状态 |
| 恢复 | 依赖聊天数据库 | `base_state.json` + 独立事件文件恢复 |
| 跨新会话记忆 | 通常没有或由产品另行实现 | 可选的用户/项目两层 `MEMORY.md` |
| 审计能力 | 通常只看对话 | 可保留被 View 压缩掉的完整事件 |

因此“聊天记录”只是 OpenHands Memory/State 系统的一部分。OpenHands 更接近 event-sourced agent runtime，而不是在消息数组后面简单追加一轮文本。

`ask_agent()` 是一个反例：它可以读取当前会话 View 回答一个临时问题，但该问题和回答不会写入事件、不会改变 ConversationState，也不会被主 Agent 记住。

## 9. 与 MCP memory 方案比较

### 9.1 先区分协议与实现

MCP 核心服务器原语是 **Tools、Resources、Prompts**，没有单独的标准 `Memory` 原语。因此“MCP memory”通常是某个 MCP Server 利用 Tools/Resources 自行实现的记忆服务，而不是 MCP 协议自动提供的会话记忆。

官方参考 `@modelcontextprotocol/server-memory` 是一个知识图谱持久记忆示例：以 entity、relation、observation 表示知识，持久化为 JSONL，并通过 9 个 Tool 和一个可订阅 Resource 暴露图谱。官方同时说明这些 reference server 主要用于演示 SDK/协议能力，不应直接等同于生产级方案。

### 9.2 对比

| 维度 | OpenHands 内建 Persistent Memory | 官方 MCP Memory 参考服务 |
|---|---|---|
| 存储模型 | 用户/项目两层 Markdown 索引与日记 | entity/relation/observation 知识图谱 |
| 存储位置 | 本地 Workspace 或用户持久目录 | MCP Server 管理的 JSONL 文件 |
| 读取方式 | 启用后在新 Conversation 启动时自动注入索引 | Host/Agent 调 Tool 搜索或读取 Resource |
| 写入方式 | Agent 使用文件 Tool，受 Prompt 指引 | 调 `create_entities`、`add_observations` 等 Tool |
| 检索 | 默认整段索引注入；日记人工按需读取 | 图查询、节点搜索、打开指定节点 |
| 跨项目范围 | 明确区分 user tier 和 project tier | 由 server 配置和 memory file 决定 |
| 与会话状态关系 | 与 EventLog/ConversationState 属于同一 SDK 体系但存储分离 | 外部服务，不自动理解 OpenHands ConversationState |
| 协议边界 | Python 进程与本地文件 | MCP transport + server 生命周期 |
| 风险 | Prompt 注入、陈旧信息、索引截断、Agent 写入质量 | 同样有错误记忆，并增加服务权限、并发、锁、超时和协议故障 |

### 9.3 如何组合

OpenHands 已能把 MCP Tool 作为 runtime tool 注入 `tools_map`，所以可以接入 MCP Memory Server：

```text
OpenHands EventLog/View
  → 保存当前 Conversation 的工作历史

OpenHands MEMORY.md
  → 保存少量、启动时必需的用户/项目背景

MCP Memory Server
  → 保存结构化、可查询、容量更大的跨会话知识
```

**主观建议：**当前学习阶段不需要立即增加 MCP Memory。内建 `MEMORY.md` 足以理解机制且依赖最少。只有当记忆量明显超过索引预算、需要实体关系查询、多 Agent 共享或跨语言服务时，MCP Memory 才更有价值。

不能把 MCP Memory Server 当作“更可靠的真相数据库”：它改善的是结构与检索，不会自动解决事实验证、过期、冲突、权限和 Prompt Injection。

## 10. REA TypeScript 分析

### 10.1 分析对象

```text
目标：software-agent-sdk/clients/typescript/src/conversation
工具：rea-agents@6.4.0
Node：v24.18.0 专用环境
方式：静态分析，未执行 OpenHands
退出码：0
```

目标包含：

- `base.ts`
- `conversation-manager.ts`
- `conversation.ts`
- `local-conversation.ts`
- `remote-conversation.ts`
- `remote-state.ts`
- `secret-registry.ts`
- `stuck-detector.ts`

### 10.2 Evidence 与统计

| 指标 | 结果 |
|---|---:|
| relevant files | 8 |
| parsed JavaScript/TypeScript files | 8 |
| parse failures | 0 |
| text bytes read | 98,465 |
| AST nodes visited | 9,903 |
| findings | 210 |
| application graph | 126 nodes / 227 edges |
| semantic graph | 4,695 nodes / 2,860 relations |
| application coverage | complete，未截断 |
| semantic coverage | unknown，未截断 |

Application edge：

- `imports`: 188
- `contains`: 16
- `exposes`: 14
- `calls`: 9

主要 Semantic relation：

- `reads`: 1,015
- `aliases`: 658
- `defines`: 502
- `captures`: 272
- `reads-property`: 269
- `awaits`: 66
- `writes`: 27
- `calls`: 15

Evidence 标识：

- evidence id：`ev_e2000a4eee6bb32fa756531afd7f9b1492ceb8068a9b24919d09587b6679081f`
- root SHA-256：`f2c6c8eddb010ba43e85fc0fb861545ebb2de09ae26cfa3bc69c356ab31068ec`
- inventory manifest：`agm_13018863173eac633d91dd3d0be7673332db2702de6ccab30a7675e937cc78c7`
- inventory graph SHA-256：`87fcba43d2fcf26ee502f6bb09f55a5e288c727b4305e7ff7696d2c30bd02124`
- application graph：`jag_4329d19a2fe2f05f6c2afa37b11399ad25bb8d8f4c993452c009ec83b190c44e`
- semantic graph：`jsrg_2fdbaa48a32a478045d63f96c9a81a5b18e90e16a8fe5dbbc23a6d0b72cef480`

### 10.3 REA 发现与人工解释

REA 对 TypeScript 目录的 import、class、async/await、属性读写和局部调用关系建立了 Evidence。结合源码人工核验，可以得到：

```text
RemoteConversation.state getter
  → new RemoteState(client, conversationId)

RemoteState.constructor()
  → new RemoteEventsList(client, conversationId)

RemoteConversation.startWebSocketClient()
  → combinedCallback(event)
      → RemoteEventsList.addEvent(event)
      → RemoteState.createStateUpdateCallback()
      → RemoteState.updateStateFromEvent(event)

RemoteState.getConversationInfo()
  → 2 秒缓存
  → 缓存失效时 GET /api/conversations/<id>

RemoteEventsList.search()/getEvents()
  → GET /api/conversations/<id>/events/search
  → 合并远程历史与 WebSocket 本地缓存
```

这证明 TypeScript 层承担“服务端状态镜像 + 事件访问”，不是 Agent 的权威 Memory 实现。

### 10.4 REA 限制

- 不能分析 Python，因此无法直接证明 `ConversationState → View → condenser → LLM` 主链；
- semantic coverage 为 `unknown`，且大量动态方法调用仍标记为 unknown；
- 静态 `calls` 关系不证明运行时一定执行；
- 分析目录没有包含 `events/remote-events-list.ts` 和底层 WebSocket 文件，这两部分由人工阅读补充；
- 没有运行服务，因此没有验证 REST、WebSocket、缓存时序、磁盘恢复或实际 Memory 注入。

## 11. 已确认事实、合理推测、建议与未验证项

### 已确认事实

- 当前 LLM 历史来自活动分支 `View`，不是直接读取完整 EventLog；
- EventLog 追加保存，Condenser 只改变 View，不删除原始事件；
- ConversationState 和 EventLog 分开保存为快照与事件文件；
- `agent_state` 是可恢复的结构化状态，但不会自动成为 LLM 消息；
- Persistent Memory 默认关闭，启用后读取两层 `MEMORY.md`；
- 自动注入的合计默认预算是 6000 字符，日记不会自动注入；
- Memory 内容被明确标注为未验证、可能过期且可能包含恶意内容；
- 两个官方 submodule 在本阶段没有被修改。

### 合理推测

- EventLog 更接近“情景记忆/审计历史”，而 `MEMORY.md` 更接近人工策展的“语义长期记忆”；这是概念映射，不是源码类名；
- 对中小型单项目，简短 `MEMORY.md` 比额外运行 MCP Memory 服务更易维护；
- 当知识规模扩大时，全文索引注入的截断和相关性问题会逐渐明显。

### 主观建议

- 调试 Agent “忘记”问题时依次检查：事件是否写入 → 当前 HEAD 是否正确 → View 是否包含 → 是否被 condenser 压缩 → Memory 开关与文件路径是否正确；
- 将操作规则放 `AGENTS.md`，将昂贵经验放 `MEMORY.md`，将长过程放每日文件，不要混成一个超长索引；
- 长期记忆中不要保存凭证，也不要把模型生成内容未经核验地当成事实。

### 未验证信息

- 未实测 `load_memory=True` 的完整新会话；
- 未实测会话冷恢复、分支导航和并发写入；
- 未实测 Condenser 的摘要质量；
- 未运行官方 MCP Memory Server，也未验证其当前发布包；
- 未验证 Canvas 设置页面到 Agent Server 的端到端开关传递；
- MCP 文档和参考服务可能在后续版本变化。

## 12. 关键调用链速查

### 当前会话历史

```text
send_message
→ MessageEvent
→ _on_event
→ ConversationState.append_event
→ EventLog.append
→ ConversationState.view
→ aprepare_llm_messages
→ events_to_messages
→ LLM.agenerate
```

### 持久状态恢复

```text
LocalConversation.__init__
→ ConversationState.create
→ read base_state.json
→ EventLog(events/)
→ rebuild_view
→ Agent.init_state
```

### 跨会话 Persistent Memory

```text
AgentContext.load_memory=True
→ LocalConversation._ensure_plugins_loaded
→ load_memory
→ AgentContext.memory_context
→ MemoryContextSection.render
→ SystemPromptEvent.dynamic_context
→ <MEMORY_CONTEXT>
```

### 上下文压缩

```text
state.view
→ LLMSummarizingCondenser.acondense
→ Condensation
→ EventLog 保留压缩事件和原历史
→ View.apply
→ CondensationSummaryEvent
→ 下一轮 LLM
```

## 13. 外部参考

- MCP 核心 Server 原语：<https://modelcontextprotocol.io/specification/draft/server/index>
- MCP 官方参考服务器说明：<https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/examples.mdx>
- MCP Memory Server：<https://github.com/modelcontextprotocol/servers/blob/main/src/memory/README.md>
- MCP Memory Server 源码：<https://github.com/modelcontextprotocol/servers/blob/main/src/memory/index.ts>

外部资料仅用于核对 MCP 协议与参考 Memory Server；OpenHands 结论以本地固定源码快照为主。
