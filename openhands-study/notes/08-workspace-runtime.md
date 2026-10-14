# OpenHands Workspace 与 Runtime

> 研究范围：只读分析本地两个官方 submodule，不启动 Agent Server、Canvas、Docker、Kubernetes 或完整 OpenHands 环境，也不修改官方源码。
>
> 源码快照：
>
> - `openhands-study/openhands`：`2bdc0e9d6c5940bc3d4667fb2127fbb753b2f7c8`
> - `openhands-study/software-agent-sdk`：`7bd668c9ab74f62c85745cd95adb503f53e7228b`

## 1. 结论先行

OpenHands 的 Workspace 和 Runtime 不是同一个概念：

- **Workspace** 是 Agent 面向任务的工作目录和操作接口，回答“代码在哪里、应以哪个目录为基准、如何上传/下载文件、查询 Git 状态”。
- **Runtime** 是真正承载 Agent、工具、Shell、依赖和进程的执行环境，回答“代码在哪台机器、哪个进程、容器或 Pod 中执行，怎样启动、停止、暂停和隔离”。

二者关系可以概括为：

```text
Conversation
  ├─ Agent / LLM / EventLog
  ├─ Workspace：工作目录与操作边界
  └─ Runtime：执行 Agent 和工具的机器、进程、容器或 Pod
         └─ 挂载或访问 Workspace
```

一个 Workspace 可以在 Runtime 被停止、替换或重新创建后继续存在。例如 Docker conversation runtime 会把宿主机的工作区、会话状态目录和持久化目录挂载进新容器；释放容器不等于删除 Workspace。

### 前提修正

1. `BaseWorkspace` 的注释把 Workspace 描述为 sandboxed environment，但抽象类本身**不提供安全隔离保证**。`LocalWorkspace` 会直接访问宿主机文件系统和执行宿主机命令。
2. Agent 读取和修改代码时，通常不是调用 `BaseWorkspace.read_file()` 或 `write_file()`。当前 `BaseWorkspace` 实际没有这两个抽象方法；Agent 使用 `FileEditorTool`，Workspace 主要向工具提供 `working_dir`。
3. “Docker 模式”也不是绝对安全。它提供进程、文件系统、用户和能力边界，但仍会暴露显式 bind mount，并可存在网络访问、`host.docker.internal` 以及配置错误风险。
4. 当前可用 REA 命令是 `analyze-javascript-application`。本阶段的 TypeScript 关系由 REA 分析，Python 调用链来自人工源码阅读；不能把 Python 部分称为 REA 自动分析结果。

## 2. Workspace 抽象是什么

### 2.1 Python SDK 的核心接口

主要文件：

| 文件 | 类/函数 | 作用 |
|---|---|---|
| `software-agent-sdk/openhands-sdk/openhands/sdk/workspace/base.py` | `BaseWorkspace` | Workspace 抽象基类 |
| 同上 | `execute_command()` | 执行命令的统一接口 |
| 同上 | `file_upload()` / `file_download()` | 在客户端与 Workspace 之间传输文件 |
| 同上 | `git_changes()` / `git_diff()` | 查询工作区中的 Git 变化 |
| 同上 | `pause()` / `resume()` | 可选的运行资源生命周期入口 |
| `software-agent-sdk/openhands-sdk/openhands/sdk/workspace/workspace.py` | `Workspace.__new__()` | 根据是否存在 `host` 返回 Local 或 Remote 实现 |
| `software-agent-sdk/openhands-sdk/openhands/sdk/workspace/local.py` | `LocalWorkspace` | 直接使用当前机器的目录和进程 |
| `software-agent-sdk/openhands-sdk/openhands/sdk/workspace/remote/base.py` | `RemoteWorkspace` | 通过 Agent Server HTTP API 操作远端环境 |
| `software-agent-sdk/openhands-sdk/openhands/sdk/workspace/remote/remote_workspace_mixin.py` | `RemoteWorkspaceMixin` | 生成 Bash、文件、Git、runtime lifecycle 请求 |

`BaseWorkspace` 的关键状态是：

```text
working_dir
conversation_id
accumulated_cost
```

它定义的核心能力是：

```text
执行命令
上传/下载文件
查询 Git changes/diff
暂停/恢复（实现可选）
关闭/清理资源
```

因此，Workspace 更接近“面向 Agent 的工作环境句柄”，而不是单纯的目录对象。

### 2.2 LocalWorkspace

调用关系：

```text
Workspace(working_dir=...)
→ Workspace.__new__
→ LocalWorkspace(working_dir=...)
```

`LocalWorkspace.execute_command()`：

```text
LocalWorkspace.execute_command
→ openhands.sdk.utils.command.execute_command
→ 在宿主机上执行命令
→ CommandResult(stdout, stderr, exit_code, timeout_occurred)
```

`LocalWorkspace.file_upload()` 和 `file_download()` 本质上使用 `shutil.copy2()` 在本地复制文件。

**已确认风险：** LocalWorkspace 不提供容器隔离。OpenHands Canvas README 也明确警告，无 sandbox 模式下 Agent Server 直接运行在机器上，Agent 会拥有该进程用户可访问的文件系统权限。

### 2.3 RemoteWorkspace

调用关系：

```text
Workspace(host=..., working_dir=...)
→ Workspace.__new__
→ RemoteWorkspace
→ RemoteWorkspaceMixin
→ Agent Server REST API
```

它并不直接操作远端磁盘，而是生成 API 请求：

| 操作 | 远端 API |
|---|---|
| 执行命令 | `/api/bash/start_bash_command`、`/api/bash/execute_bash_command` |
| 上传文件 | `/api/file/upload` |
| 下载文件 | `/api/file/download` |
| Git changes | `/api/git/changes` |
| Git diff | `/api/git/diff` |
| 获取/释放 runtime | `/api/runtime` |

如果提供 `conversationId`，TypeScript 客户端的 `ConversationScopedHttpClient.request()` 会优先把普通 `/api/...` 请求改写为：

```text
/api/conversations/{conversationId}/...
```

如果服务端不支持 conversation runtime routes，则退回历史兼容方式，把 conversation id 放入 `cid` 查询参数。

### 2.4 TypeScript Workspace

主要文件：

| 文件 | 类/函数 | 作用 |
|---|---|---|
| `software-agent-sdk/clients/typescript/src/workspace/base.ts` | `IWorkspace` | TypeScript Workspace 契约 |
| `software-agent-sdk/clients/typescript/src/workspace/workspace.ts` | `createWorkspace()` / `createWorkspaceAuto()` | Local/Remote 工厂 |
| `software-agent-sdk/clients/typescript/src/workspace/remote-workspace.ts` | `RemoteWorkspace` | 浏览器兼容的远端实现 |
| `software-agent-sdk/clients/typescript/src/workspace/local-workspace.ts` | `LocalWorkspace` | 当前只是抛错 stub |
| `software-agent-sdk/clients/typescript/src/client/runtime-transport.ts` | `createRuntimeHttpClients()` | 创建 host client 与 conversation-scoped runtime client |

重要区别：TypeScript 的 `LocalWorkspace` 当前不是浏览器本地文件执行器。其方法统一抛出 `LocalWorkspaceNotSupportedError`，提示使用 `RemoteWorkspace`。这符合 TypeScript 客户端必须保持浏览器兼容、不能直接使用 Node `fs` 或 `child_process` 的约束。

## 3. Agent 如何读取和修改文件

### 3.1 Workspace 提供根目录，FileEditorTool 执行实际操作

主要文件：

| 文件 | 类/函数 |
|---|---|
| `software-agent-sdk/openhands-tools/openhands/tools/file_editor/definition.py` | `FileEditorTool.create()` |
| `software-agent-sdk/openhands-tools/openhands/tools/file_editor/impl.py` | `FileEditorExecutor.__call__()` |
| `software-agent-sdk/openhands-tools/openhands/tools/file_editor/editor.py` | `FileEditor.__call__()` |
| 同上 | `view()` / `read_file()` |
| 同上 | `str_replace()` / `insert()` / `write_file()` / `undo_edit()` |
| 同上 | `_atomic_write()` |

初始化调用链：

```text
LocalConversation._ensure_agent_ready
→ AgentBase._initialize(state)
→ resolve_tool(..., state)
→ FileEditorTool.create(conv_state)
→ workspace_root = conv_state.workspace.working_dir
→ FileEditorExecutor(workspace_root=...)
→ FileEditor(workspace_root=...)
```

读文件：

```text
LLM tool call: file_editor(command="view", path=...)
→ Agent._handle_tool_calls / _get_action_event
→ ActionEvent
→ Agent._execute_action_event
→ ToolDefinition.__call__
→ FileEditorExecutor.__call__
→ FileEditor.__call__
→ FileEditor.view
→ FileEditor.read_file
→ FileEditorObservation
→ ObservationEvent
```

修改文件：

```text
file_editor(create / str_replace / insert / undo_edit)
→ FileEditorExecutor.__call__
→ FileEditor.__call__
→ write_file
→ _atomic_write
→ 同目录临时文件
→ Path.replace 原子替换目标文件
→ FileEditorObservation
→ ObservationEvent
```

`_atomic_write()` 的价值在于：先把完整内容写到目标文件旁的临时文件，再替换原文件，避免写入失败时留下截断文件；已有文件的权限位也会被保留。

### 3.2 路径限制的真实边界

`FileEditor.validate_path()` 要求路径是当前宿主系统认可的绝对路径，并检查文件是否存在、命令与文件类型是否匹配。

但需要注意：

- `workspace_root` 主要用于保存当前工作目录和生成相对路径建议；
- `FileEditor.validate_path()` 本身没有统一执行“目标必须位于 workspace_root 下”的检查；
- `FileEditorExecutor` 可以通过 `allowed_edits_files` 限定可编辑文件，但这是可选参数；
- 因此真正的文件系统边界主要来自 Runtime：容器挂载范围、运行用户权限，以及服务端 conversation-scoped API 的路径检查。

这是理解安全模型的关键：**Workspace 的 `working_dir` 是工作基准，不自动等于强制安全沙箱。**

### 3.3 客户端文件传输不是 Agent 的 FileEditor

TypeScript `RemoteWorkspace.fileUpload()` / `fileDownload()` 和 `FileClient` 通过 HTTP 上传、下载文件，适合 Canvas、SDK 用户或外部客户端。

Agent 自己的代码编辑则通常发生在 Runtime 内部，由 `FileEditorTool` 直接访问本地挂载路径。两条链作用在同一个工作区，但入口不同：

```text
Canvas/SDK 用户
→ RemoteWorkspace / FileClient
→ HTTP
→ Agent Server file_router
→ Workspace 文件

Agent
→ FileEditorTool
→ Runtime 内文件系统
→ Workspace 文件
```

## 4. Runtime 与 Workspace 的区别

关键实现位置：

| 文件 | 类/函数 | 作用 |
|---|---|---|
| `software-agent-sdk/openhands-agent-server/openhands/agent_server/conversation_registry.py` | `ConversationRegistry` / `create_conversation_registry()` | 选择 host-local 或 Docker conversation runtime |
| `software-agent-sdk/openhands-agent-server/openhands/agent_server/runtime_router.py` | `bind_local_conversation_runtime()` | 把会话绑定到 Bash、File、Git、VSCode 路由 |
| `software-agent-sdk/openhands-agent-server/openhands/agent_server/docker_runtime/registry.py` | `DockerConversationRegistry` / `_build_container()` | 创建、复用、停止每会话容器 |
| `software-agent-sdk/openhands-agent-server/openhands/agent_server/docker_runtime/routers.py` | `start_conversation()` | 创建 provisioning 记录并把会话请求转发到容器 |
| `software-agent-sdk/openhands-agent-server/openhands/agent_server/docker_runtime/proxy.py` | `proxy_http()` / `bridge_websocket()` | 将外层 HTTP/WebSocket 请求转发到内层 Agent Server |
| `software-agent-sdk/openhands-agent-server/openhands/agent_server/docker_runtime/provisioning.py` | `RuntimeIdentity` / `RuntimeProvisioningStore` | 保存每个 Runtime 的端口、session key 和 encryption key |

| 维度 | Workspace | Runtime |
|---|---|---|
| 核心含义 | 工作目录、文件和 Git 操作对象 | 执行 Agent 与工具的活跃环境 |
| 主要状态 | `working_dir`、连接信息 | 进程/容器/Pod、镜像、端口、凭证、资源限制 |
| 生命周期 | 可随会话状态保留 | 可启动、停止、暂停、恢复、回收 |
| 文件持久性 | 可以持久保存 | Runtime 被替换后可重新挂载同一 Workspace |
| 安全作用 | 给工具提供任务范围和路径基准 | 提供真正的进程、用户、文件系统和资源边界 |
| 本地实现 | `LocalWorkspace` | 当前 Agent Server 进程 |
| 远端实现 | `RemoteWorkspace` | 远端 Agent Server、Docker 容器或 Kubernetes Pod |

### 4.1 Host-local runtime

`ConversationRegistry` 是 host-local 模式的默认实现：

```text
create_conversation_registry(config)
→ conversation_runtime != "docker"
→ ConversationRegistry
→ create_runtime_router()
→ Bash / File / Git / VSCode routes
```

`runtime_router.py` 明确说明，本地进程和 VSCode 仍共享宿主机；其中的路径检查是路由保护，不是任意 Shell 命令的 sandbox。

### 4.2 Per-conversation Docker runtime

当 `OH_CONVERSATION_RUNTIME=docker`：

```text
create_conversation_registry(config)
→ DockerConversationRegistry
```

创建会话时：

```text
docker_runtime.routers.start_conversation
→ 校验请求中的 workspace 必须是 LocalWorkspace
→ RuntimeProvisioningStore.create
→ 把容器内 workspace 重写为 LocalWorkspace('/workspace')
→ DockerConversationRegistry.get_or_create
→ _build_container
→ docker run
→ 等待容器 /health
→ 把创建会话请求转发到容器内 Agent Server
```

这不是简单地“把一个 Shell 放进容器”。每个会话容器中运行的是完整 Agent Server，因此 Agent、工具、Conversation、事件流和 Shell 都位于同一 Runtime 内。

### 4.3 其他 Runtime/Workspace 后端

`openhands-workspace` 包还提供：

| 实现 | 文件 | 含义 |
|---|---|---|
| `DockerWorkspace` | `openhands-workspace/openhands/workspace/docker/workspace.py` | 创建一个运行 Agent Server 的 Docker 容器，并以 `RemoteWorkspace` 访问 |
| `ApptainerWorkspace` | `.../apptainer/workspace.py` | 用 Apptainer/Singularity 风格容器运行 Agent Server |
| `APIRemoteWorkspace` | `.../remote_api/workspace.py` | 调用托管 Runtime API 启动、暂停、恢复容器 |
| `AgentSandboxWorkspace` | `.../agent_sandbox/workspace.py` | 从 Kubernetes agent-sandbox warm pool 领取 Pod |
| Cloud workspace | `.../cloud/workspace.py` | 连接 OpenHands Cloud sandbox/runtime |

这里容易混淆两种 Docker 入口：

1. `DockerWorkspace` 是 SDK 侧的一种 Workspace 实现，由调用者创建并管理 Agent Server 容器；
2. `DockerConversationRegistry` 是 Agent Server 的 conversation runtime 模式，由外层 Agent Server 为每个会话管理独立容器。

二者都使用 Docker，但生命周期所有者和路由位置不同。

## 5. Shell 执行环境如何接入

OpenHands 中至少有两条 Shell 链路。

### 5.1 Agent 的 TerminalTool

主要文件：

| 文件 | 类/函数 |
|---|---|
| `software-agent-sdk/openhands-tools/openhands/tools/terminal/definition.py` | `TerminalTool.create()` |
| `software-agent-sdk/openhands-tools/openhands/tools/terminal/impl.py` | `TerminalExecutor` |
| `software-agent-sdk/openhands-tools/openhands/tools/terminal/terminal/factory.py` | `create_terminal_session()` |
| `software-agent-sdk/openhands-tools/openhands/tools/terminal/terminal/terminal_session.py` | `TerminalSession.execute()` |
| `software-agent-sdk/openhands-tools/openhands/tools/terminal/terminal/interface.py` | `TerminalInterface` |

初始化：

```text
TerminalTool.create(conv_state)
→ working_dir = conv_state.workspace.working_dir
→ TerminalExecutor(working_dir=...)
→ create_terminal_session(...)
→ tmux / subprocess / PowerShell backend
```

执行：

```text
LLM tool call: terminal(command="pytest ...")
→ ActionEvent
→ Agent._execute_action_event
→ ToolDefinition.__call__
→ TerminalExecutor.__call__
→ TerminalSession.execute
→ TerminalInterface.send_keys / read_screen
→ 识别结束标记、exit code、cwd、timeout
→ TerminalObservation
→ ObservationEvent
```

Terminal session 是持久会话：当前目录和部分 Shell 状态可跨命令保留。后端选择逻辑为：

- Windows：PowerShell；
- Unix 且 tmux 可用：tmux；
- 否则：subprocess terminal。

Tool 返回的不只是文字，还包括退出码、当前工作目录、超时状态等结构化元数据，这些信息会进入下一轮 LLM 上下文。

### 5.2 Canvas/SDK 的 Bash API

主要文件：

| 文件 | 类/函数 |
|---|---|
| `software-agent-sdk/clients/typescript/src/client/bash-client.ts` | `BashClient.startCommand()` / `executeCommand()` |
| `software-agent-sdk/clients/typescript/src/workspace/remote-workspace.ts` | `RemoteWorkspace.executeCommand()` |
| `software-agent-sdk/openhands-agent-server/openhands/agent_server/bash_router.py` | `start_bash_command()` / `execute_bash_command()` |
| `software-agent-sdk/openhands-agent-server/openhands/agent_server/bash_service.py` | `BashEventService` |
| 同上 | `_execute_bash_command()` |

调用链：

```text
Canvas / TypeScript SDK
→ RemoteWorkspace.executeCommand 或 BashClient.executeCommand
→ POST /api/bash/execute_bash_command
→ conversation-scoped runtime route
→ bash_router.execute_bash_command
→ BashEventService.start_bash_command
→ asyncio.create_subprocess_shell(command, cwd=...)
→ BashOutput 持久记录与返回
```

这条链主要服务于 UI Terminal、SDK 调用和手工 Runtime 操作，与 Agent 内部的 `TerminalTool` 不是同一个调用入口。

## 6. Docker / Sandbox 隔离思想

### 6.1 Docker conversation runtime 做了什么

`DockerConversationRegistry._build_container()` 为每个 conversation 创建容器，并使用：

```text
--user <宿主 uid>:<宿主 gid>
--cap-drop ALL
--security-opt no-new-privileges
--ulimit core=0
-p 127.0.0.1::<container 8000>
```

可选限制包括：

```text
--memory
--cpus
--pids-limit
```

容器只显式挂载三类持久目录：

```text
宿主 conversation_dir → /var/openhands/conversations/{id}
宿主持久化目录        → /home/openhands/.openhands
宿主 workspace_dir    → /workspace
```

容器内部设置：

```text
OH_CONVERSATION_RUNTIME=local
```

含义是：外层 Agent Server 负责 Docker runtime；内层 Agent Server 把自己视为本地执行器，避免递归创建 Docker runtime。

### 6.2 请求和凭证边界

外层 Agent Server：

- 为每个 conversation 保存独立的 `RuntimeIdentity`；
- 为内层 Agent Server 生成 session API key 和 encryption key；
- 通过 `proxy_http()` / `bridge_websocket()` 转发 HTTP 和 WebSocket；
- 对内层请求注入该 runtime 的 session key；
- 只在 loopback 地址发布随机宿主端口；
- 空闲时可停止容器，但保留已挂载的会话和 Workspace 数据。

### 6.3 路径路由保护

host-local conversation runtime 的 `bind_local_conversation_runtime()` 会检查 `path` 和 `workspace_dir`：

```text
必须是绝对路径
resolve 后必须位于 conversation.workspace.working_dir 下
```

这能保护 HTTP File/Git/VSCode 路由不跨 Workspace 访问，但源码注释明确指出，它不是任意 Shell 命令的 sandbox。Agent 的 Shell 能做什么，最终取决于运行它的 OS 用户和 Runtime 隔离。

### 6.4 Sandbox 不是绝对边界

已确认的限制：

- Docker 容器仍显式添加了 `host.docker.internal:host-gateway`；
- 网络并未在 `_build_container()` 中统一禁用；
- bind mount 中的文件对容器内 Agent 可见并可修改；
- 如果多个 conversation 选择同一个宿主 Workspace，它们仍可共享和冲突；
- Canvas 和外层 Agent Server 不会因为 conversation 使用 Docker 就自动进入同一 sandbox；
- 无 sandbox 的 LocalWorkspace 直接拥有宿主进程用户权限。

因此正确理解是：Docker/Kubernetes 显著缩小爆炸半径，但不能替代最小化挂载、限制网络、非特权用户、资源限额、凭证隔离和人工确认。

### 6.5 Kubernetes agent-sandbox

`AgentSandboxWorkspace`：

```text
SandboxWarmPool
→ create_sandbox / claim pod
→ port-forward 或 direct connection
→ Pod 内 Agent Server
→ RemoteWorkspace API
```

该实现支持暂停/恢复，并可通过 Kubernetes `runtimeClass` 选择 gVisor 或 Kata 等更强隔离后端；持久卷使 Workspace 在 Pod suspend/resume 后继续存在。

## 7. 从修改代码到验证测试的完整链路

以下是标准 OpenHands Agent 的典型链路。具体工具名和测试命令由模型、Agent preset、项目说明和用户请求共同决定。

核心文件：

| 文件 | 类/函数 | 作用 |
|---|---|---|
| `software-agent-sdk/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py` | `LocalConversation.send_message()` / `arun()` / `_ensure_agent_ready()` | 接收消息、初始化 Agent/Tool 并驱动执行循环 |
| `software-agent-sdk/openhands-sdk/openhands/sdk/agent/agent.py` | `Agent.astep()` / `_get_action_event()` / `_execute_action_event()` | 调用 LLM、构造 Action、执行 Tool、构造 Observation |
| `software-agent-sdk/openhands-sdk/openhands/sdk/agent/response_dispatch.py` | `ResponseDispatchMixin._handle_tool_calls()` / `_ahandle_tool_calls()` | 将 LLM 的 tool calls 分派为一批 Action |
| `software-agent-sdk/openhands-sdk/openhands/sdk/tool/tool.py` | `ToolDefinition.__call__()` | 把结构化 Action 交给具体 Tool executor |
| `software-agent-sdk/openhands-sdk/openhands/sdk/event/` | `MessageEvent` / `ActionEvent` / `ObservationEvent` | 保存请求、操作意图和执行结果 |

### 阶段 A：接收任务并理解仓库

```text
用户请求
→ LocalConversation.send_message
→ MessageEvent
→ ConversationState / EventLog
→ LocalConversation.arun
→ Agent.astep
→ state.view
→ prepare_llm_messages
→ LLM.generate / agenerate（携带工具 schema）
```

LLM 可以先调用：

```text
file_editor(view)
terminal(rg / git status / test discovery)
```

每次工具调用都会产生：

```text
ActionEvent → Tool → ObservationEvent
```

Observation 被追加到会话历史，下一轮 LLM 可见。

### 阶段 B：修改代码

```text
LLM 选择 file_editor
→ _handle_tool_calls / _get_action_event 验证参数并创建 ActionEvent
→ 可选的安全分析、确认和 pre-tool hook
→ _execute_action_event
→ FileEditorExecutor
→ FileEditor.str_replace / insert / create
→ 原子写入 Workspace 文件
→ FileEditorObservation（包含前后内容或 diff）
→ ObservationEvent
```

Agent 下一轮可以读取修改后的内容、检查 diff，或根据错误重新编辑。

### 阶段 C：运行验证

```text
LLM 选择 terminal
→ TerminalAction(command="项目测试命令")
→ ActionEvent
→ TerminalExecutor
→ TerminalSession.execute
→ Runtime 中的 Shell
→ 编译器 / 测试框架 / linter
→ stdout + stderr + exit code + cwd
→ TerminalObservation
→ ObservationEvent
```

### 阶段 D：根据结果迭代

```text
exit code != 0
→ 下一轮 LLM 读取错误
→ 再次 view / grep / edit
→ 重新运行最小相关测试

exit code == 0
→ 可继续运行更广验证、git diff/status
→ FinishTool
→ ConversationExecutionStatus.FINISHED
```

如果 hook、确认模式或安全分析拒绝操作，Action 不会直接执行；对应结果会进入事件流，使 Agent 调整下一步。

### 完整主链速查

```text
MessageEvent
→ Agent.astep
→ LLM tool call
→ Agent._handle_tool_calls / _get_action_event
→ ActionEvent
→ Agent._execute_action_event
→ ToolDefinition.__call__
→ FileEditorExecutor / TerminalExecutor
→ Workspace 文件系统 / Runtime Shell
→ FileEditorObservation / TerminalObservation
→ ObservationEvent
→ EventLog + View
→ 下一轮 Agent.astep
→ 修复或 FinishTool
```

## 8. 为什么 OpenHands 不是普通聊天机器人

普通聊天机器人通常只做：

```text
输入消息 → 生成文本 → 输出消息
```

OpenHands 的核心循环是：

```text
理解任务
→ 检查真实仓库
→ 选择结构化工具
→ 修改真实文件
→ 在真实 Shell 中执行构建/测试
→ 读取退出码与错误
→ 基于 Observation 继续修复
→ 检查 Git diff/status
→ 完成任务
```

它像 AI 软件工程师的原因不是“回答更像工程师”，而是具备工程执行闭环：

1. **有工作对象**：Workspace 指向真实项目，而不是只接收用户粘贴的代码片段。
2. **有操作能力**：FileEditor、Terminal、Git、浏览器和 MCP 工具能产生外部副作用。
3. **有运行环境**：Runtime 提供 OS、Shell、依赖、进程以及可选容器隔离。
4. **有反馈闭环**：工具 Observation、测试退出码和错误日志进入下一轮决策。
5. **有状态轨迹**：Message、Action、Observation、状态变化都保存在事件历史中。
6. **有验证能力**：它可以运行真实测试，而不是只声称代码“看起来正确”。
7. **有恢复与持久性**：会话状态和 Workspace 可以在 Runtime 重建后继续使用。

但它仍不等于人类工程师：

- 测试通过不代表需求完全正确；
- LLM 可能选错命令、遗漏边界条件或误读架构；
- Sandbox 强度取决于部署配置；
- 对生产、凭证、网络和破坏性命令仍需权限控制和人工复核。

更准确的定义是：**OpenHands 是一个把 LLM 决策、结构化工具、真实 Workspace、可执行 Runtime 和事件反馈循环组合起来的软件工程 Agent 系统。**

## 9. REA TypeScript 分析

### 9.1 分析对象与命令边界

分析目录：

```text
software-agent-sdk/clients/typescript/src/workspace
```

文件：

```text
base.ts
workspace.ts
remote-workspace.ts
local-workspace.ts
```

执行环境：

```text
Node v24.18.0
rea-agents@6.4.0
analyze-javascript-application --json
```

未保存 raw output，未写入 submodule。

### 9.2 统计与 Evidence

| 指标 | 结果 |
|---|---:|
| exit code | 0 |
| relevant files | 4 |
| parsed JavaScript/TypeScript files | 4 |
| parse failures | 0 |
| text bytes read | 24,351 |
| visited AST nodes | 1,838 |
| findings | 54 |
| Application Graph nodes | 33 |
| Application Graph edges | 62 |
| Semantic Graph nodes | 959 |
| Semantic Graph relations | 559 |

Application Graph 关系：

```text
imports: 43
contains: 8
calls: 6
exposes: 5
```

Semantic Graph 主要关系：

```text
reads: 182
defines: 123
aliases: 111
reads-property: 52
captures: 44
writes: 14
awaits: 11
calls: 11
writes-property: 5
argument-to-parameter: 2
coerces: 2
returns-to-call: 2
```

Evidence：

```text
evidence_id:
ev_eb64d0d7ed2ad07cfcadb5363438dd74ea3e50da056175738d2ab0681571d96d

root_artifact_sha256:
7225a57ee1f7f6a7a3d474e9aa8df342589cf8439093d9716c1e776ec4d451c6

inventory_manifest_id:
agm_11f718be4bfd0e496cb63e458f5ac68326e06dda154be4b8814c58e5721c1248

inventory_graph_sha256:
cbcbff95ea5a0aeac554e1359391f7f4992ad75bfaf215abca02bebb83ae5568

application_graph_id:
jag_690786701ef4a9e581e9e3ade53634259efe06a44d4de510ed2be45a9af8b7d4

semantic_graph_id:
jsrg_a89a3af936b985c543a4771f60bf306d4199b5c1c8268419d31a43352ff56edb
```

Application Graph coverage 为 complete，未截断；Semantic Graph coverage 为 unknown，但报告未截断、未省略节点或关系。

### 9.3 REA 发现的关键关系

REA 精确识别到 `remote-workspace.ts` 暴露的网络端点：

```text
/api/auth/workspace-session
/api/bash/execute_bash_command
/api/file/download
/api/git/changes
/api/git/diff
```

REA 还确认：

```text
Workspace extends RemoteWorkspace
createWorkspace / createWorkspaceAuto
→ RemoteWorkspace 或 LocalWorkspace

RemoteWorkspace
→ createRuntimeHttpClients
→ BashClient
→ Bash/File/Git API
```

由于分析根目录只包含 `src/workspace`，`../client/runtime-transport`、`../models/workspace` 等跨目录 import 被标记为分析边界外或未解析。它们由人工源码阅读补全，不能把跨目录完整调用链全部归功于 REA。

### 9.4 REA 对 Python 的限制

当前本地已验证的 REA CLI 只提供 JavaScript application 静态分析流程。本阶段没有获得 Python AST/语义图 Evidence。

所以：

- TypeScript Workspace 关系、端点和静态数据流：REA + 人工核对；
- Python Workspace、Runtime、FileEditor、Terminal、Docker 调用链：人工源码阅读；
- Docker/Shell 的运行时行为：未实际启动，结论只代表源码设计，不代表当前机器上的动态验证结果。

## 10. 事实、推测、建议与未验证项

### 已确认事实

- `LocalConversation` 当前只接受字符串、Path 或 `LocalWorkspace`，并把路径转换为 `LocalWorkspace`。
- `FileEditorTool.create()` 和 `TerminalTool.create()` 都从 `ConversationState.workspace.working_dir` 获取工作目录。
- FileEditor 使用同目录临时文件和 `Path.replace()` 完成原子写入。
- Agent 工具调用被记录为 `ActionEvent`，工具结果被包装成 `ObservationEvent`。
- TypeScript `LocalWorkspace` 是 stub；实际浏览器客户端通过 `RemoteWorkspace` 调用 Agent Server。
- host-local runtime 的路径检查不是 Shell sandbox。
- Docker conversation runtime 会给每个 conversation 创建 Agent Server 容器，并挂载 workspace、conversation state 和 persistence。
- Docker runtime 使用 `cap-drop ALL`、`no-new-privileges`、loopback 端口和可选 CPU/内存/PID 限制。
- 两个 submodule 在本次研究前后均未修改。

### 合理推测

- 把 Workspace 数据与 Runtime 生命周期分离，主要是为了让会话在容器回收、暂停和重建后继续工作，并降低长时间占用计算资源的成本。
- 让 Agent 工具直接在 Runtime 内访问文件，比每次编辑都经 HTTP 往返更简单，也使文件和 Shell 看到同一套挂载路径。
- TypeScript LocalWorkspace 保持 stub，是为了维护浏览器兼容边界，避免在客户端库中引入 Node 文件系统和进程权限。

这些推测与代码结构一致，但不是源码中统一声明的正式设计结论。

### 主观建议

- 学习时先用“Workspace 是磁盘和任务范围，Runtime 是计算与隔离边界”建立心智模型。
- 生产环境优先使用每会话隔离、最小 bind mount、非特权用户、资源限制和受控网络。
- 不要因为启用了 Docker 就省略人工确认、密钥分级、Git diff 审查和测试验证。
- 调试时先判断问题属于 Workspace 路径/权限，还是 Runtime 镜像/依赖/进程生命周期，能显著减少误判。

### 未验证信息

- 没有启动 Docker，因此未动态验证当前 Windows 主机上的 volume、网络、用户映射和 pause/resume 行为。
- 没有启动 Agent Server，因此未动态验证 REST/WebSocket 路由和 session key。
- 没有实际让 Agent 修改项目并运行测试，本章完整链路来自静态代码追踪。
- 没有动态验证 gVisor、Kata、Apptainer、Cloud 或 Kubernetes agent-sandbox。
- 没有用 REA 自动分析 Python。

## 11. 最小心智模型

```text
Workspace = Agent 要工作的项目与文件
Runtime   = Agent 在哪里、以什么权限和依赖执行
Tool      = Agent 对 Workspace/Runtime 发起的结构化操作
Event     = 操作意图和结果的可追踪记录
LLM       = 根据历史、代码和 Observation 选择下一步
```

把它们组合起来：

```text
LLM 决策
→ Tool Action
→ Runtime 执行
→ Workspace 改变
→ Observation 返回
→ LLM 根据真实结果继续
```

这就是 OpenHands 从“聊天”走向“软件工程执行”的核心。
