# OpenHands 代码结构与核心模块

> 研究快照：2026-10-13。目录描述对应本学习仓库锁定的 submodule 提交。

## 1. 学习目录

```text
openhands-study/
├─ openhands/                  # 官方 OpenHands / Agent Canvas submodule
├─ software-agent-sdk/         # 官方 Agent 核心与服务 submodule
├─ notes/                      # 本项目的学习笔记
└─ rea-analysis/raw-output/    # REA 原始输出，本地保留且被忽略
```

两个 submodule 都不放置学习笔记，不修改官方源码。

## 2. Agent Canvas：`openhands/`

```text
openhands/
├─ src/
│  ├─ api/             # Agent Server/Cloud API 适配与服务接口
│  ├─ components/      # 业务 UI 组件
│  ├─ routes/          # React Router 页面与路由
│  ├─ hooks/           # UI 与数据访问 hooks
│  ├─ stores/          # Zustand 前端状态
│  ├─ context(s)/      # React 上下文
│  ├─ services/        # 前端服务层
│  ├─ i18n/            # 国际化
│  ├─ mocks/           # 测试/开发模拟
│  ├─ themes/          # 主题
│  └─ wrapper/         # 集成包装层
├─ bin/                # 启动与辅助脚本
├─ scripts/            # 构建/维护脚本
├─ electron/           # 桌面端相关代码（如当前树存在）
├─ package.json
└─ docs/architecture.md
```

本快照 `src/api` 下的主要服务域包括：

- `conversation-service`：会话的创建、读取、控制与事件交互；
- `backend-registry`：多个后端的注册、活动后端与健康状态；
- `cloud`：OpenHands Cloud 代理与 API；
- `runtime-service`、`bash-service`、`git-service`：运行时、命令与 Git 接口；
- `settings-service`、`config-service`、`profiles-service`：设置和配置；
- `mcp-service`、`mcp-health`、`tool-catalog-service`：工具/MCP 能力；
- `automation-service`、`event-service`、`workspaces-service`：自动化、事件和工作区。

### Canvas 核心路径

| 目标 | 建议入口 |
| --- | --- |
| 理解边界 | [`docs/architecture.md`](../openhands/docs/architecture.md) |
| 应用依赖/脚本 | [`package.json`](../openhands/package.json) |
| API 聚合关系 | [`src/api`](../openhands/src/api/) |
| 对话 API | [`conversation-service`](../openhands/src/api/conversation-service/) |
| 后端切换 | [`backend-registry`](../openhands/src/api/backend-registry/) |
| 云端转发 | [`cloud`](../openhands/src/api/cloud/) |

## 3. Software Agent SDK：`software-agent-sdk/`

```text
software-agent-sdk/
├─ openhands-sdk/              # Agent 核心、Conversation、事件、上下文、LLM、工具抽象
├─ openhands-tools/            # 终端、编辑、浏览器、检索、规划等具体工具
├─ openhands-workspace/        # Docker/Sandbox/Apptainer/Cloud/远程工作区
├─ openhands-agent-server/     # FastAPI REST/WebSocket 服务
├─ clients/typescript/         # Agent Server TypeScript 客户端
├─ examples/                   # 独立 SDK 与服务用例
├─ tests/                      # 跨包测试
└─ scripts/                    # 仓库维护脚本
```

### 3.1 `openhands-sdk`

核心源码根目录是 `openhands-sdk/openhands/sdk/`：

| 目录 | 职责 |
| --- | --- |
| `agent/` | Agent 步骤、并行工具执行、Agent 类型 |
| `conversation/` | 会话生命周期、状态、事件循环、持久化接口 |
| `event/` | 消息、动作、观察、系统事件模型 |
| `context/` | prompt、View、condenser、持久记忆加载 |
| `llm/` | 模型调用、响应与指标处理 |
| `tool/` | ToolDefinition、ToolExecutor、client tool 抽象 |
| `workspace/` | 基础 Workspace 与远端接口 |
| `security/` | 风险、确认和安全相关模型 |
| `mcp/` | MCP 工具与接入 |
| `skills/` | Skills 加载和上下文 |
| `subagent/` | 子 Agent/委派相关实现 |
| `io/` | FileStore 等 I/O 抽象 |
| `observability/` | 遥测和可观测性 |

推荐首先阅读：

1. [`agent/agent.py`](../software-agent-sdk/openhands-sdk/openhands/sdk/agent/agent.py)
2. [`conversation/impl/local_conversation.py`](../software-agent-sdk/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py)
3. [`tool/tool.py`](../software-agent-sdk/openhands-sdk/openhands/sdk/tool/tool.py)
4. [`event`](../software-agent-sdk/openhands-sdk/openhands/sdk/event/)
5. [`context`](../software-agent-sdk/openhands-sdk/openhands/sdk/context/)
6. [`workspace/workspace.py`](../software-agent-sdk/openhands-sdk/openhands/sdk/workspace/workspace.py)

### 3.2 `openhands-tools`

这里放置可被 Agent 组合使用的具体工具和 preset。与本阶段最相关的路径：

- [`preset/planning.py`](../software-agent-sdk/openhands-tools/openhands/tools/preset/planning.py)：Planning Agent 预设；
- [`planning_file_editor`](../software-agent-sdk/openhands-tools/openhands/tools/planning_file_editor/)：受限的 `PLAN.md` 编辑；
- 终端、文件编辑、Glob/Grep、浏览器、MCP、Task/Delegate、Finish/Think 等工具目录。

工具包是“能力实现”，`openhands-sdk` 中的 `ToolDefinition`/`ToolExecutor` 是“协议与执行边界”。

### 3.3 `openhands-workspace`

主要实现位于 `openhands-workspace/openhands/workspace/`：

| 路径 | 用途 |
| --- | --- |
| `docker/workspace.py` | Docker 工作区 |
| `agent_sandbox/workspace.py` | Agent Sandbox 工作区 |
| `apptainer/workspace.py` | Apptainer 工作区 |
| `cloud/workspace.py` | OpenHands Cloud 工作区 |
| `remote_api/workspace.py` | 远程 API 工作区 |

本地 Workspace 的基础实现位于核心 SDK。选择哪种实现会直接影响安全边界、启动成本和可复现性。

### 3.4 `openhands-agent-server`

核心入口与服务包括：

- [`api.py`](../software-agent-sdk/openhands-agent-server/openhands/agent_server/api.py)：FastAPI 应用组合；
- `conversation_router.py` / `conversation_service.py`：会话 API 与业务逻辑；
- `event_router.py` / `event_service.py`：事件读写；
- `workspace_router.py` / `workspaces_router.py`：工作区；
- `runtime_router.py`、`bash_router.py`、`file_router.py`、`git_router.py`：执行能力；
- `session_socket.py` / `sockets.py`：实时连接；
- `persistence/`、`storage/`：状态持久化；
- `docker_runtime/`：Docker Runtime 的供应、代理与注册。

## 4. 核心模块依赖方向

```text
Canvas UI
  └─ src/api 服务适配
       └─ TypeScript Client / REST / WebSocket
            └─ Agent Server
                 ├─ Conversation
                 │    ├─ Agent
                 │    │    ├─ LLM
                 │    │    ├─ Context / Memory / Condenser
                 │    │    └─ Tool definitions
                 │    └─ Event log
                 └─ Workspace / concrete tools
```

重要边界：Canvas 不应直接实现 Agent 推理；具体工具不应取代 SDK 的工具协议；Workspace 是命令与文件操作的执行边界；Conversation 则是 Agent 和执行环境之间的状态协调层。

## 5. 规模快照

通过 `git ls-files` 统计，本次固定快照大致为：

- Agent Canvas：2668 个受 Git 跟踪文件，其中约 1149 个 `.ts`、1086 个 `.tsx`；
- Software Agent SDK：1909 个受 Git 跟踪文件，其中约 1412 个 `.py`、119 个 `.ts`、16 个 `.tsx`。

这些数字只用于建立阅读规模感，不是代码行数，也会随上游提交变化。

## 6. 推荐阅读顺序

1. 先读两个仓库 README 和 Canvas `docs/architecture.md`，建立边界。
2. 从 `LocalConversation.run()` 跟到 `Agent.step()`，掌握主循环。
3. 阅读 event 模型，理解 Action 与 Observation 如何形成反馈闭环。
4. 阅读 `ToolDefinition` 和一个简单工具，再看并行执行器。
5. 阅读 Workspace 抽象及一种隔离实现。
6. 最后回到 Canvas `src/api/conversation-service`，观察 UI 如何接入后端。

这一顺序比按目录逐个阅读更容易形成一条可验证的端到端链路。
