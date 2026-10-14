# OpenHands 项目概览

> 研究快照：2026-10-13。本文基于固定的 Git submodule 提交，不代表未来版本。

## 1. 范围与前提校正

“OpenHands 官方源码”目前不是一个仓库就能完整代表的单体项目。本学习目录固定了两个官方仓库：

| 子模块 | 固定提交 | 本次研究定位 |
| --- | --- | --- |
| [`OpenHands/OpenHands`](../openhands/) | `2bdc0e9d6c5940bc3d4667fb2127fbb753b2f7c8` | Agent Canvas：Web/Electron 用户界面、API 适配与本地服务编排 |
| [`OpenHands/software-agent-sdk`](../software-agent-sdk/) | `7bd668c9ab74f62c85745cd95adb503f53e7228b` | Agent 核心、工具、会话、工作区和 Agent Server |

因此，下文把“OpenHands 项目”理解为这两个仓库构成的开源核心，而不是只把 Canvas 前端当作完整 Agent 实现。官方入口包括 [OpenHands 主仓库](https://github.com/OpenHands/OpenHands)、[Software Agent SDK 仓库](https://github.com/OpenHands/software-agent-sdk) 和 [SDK 架构概览](https://github.com/OpenHands/docs/blob/main/sdk/arch/overview.mdx)。

## 2. 项目用途

OpenHands 是面向软件开发任务的 AI Agent 平台。用户通过 Canvas 或 SDK 提交任务，Agent 结合大语言模型、上下文、工具和受控工作区执行代码阅读、编辑、命令运行、网页操作及多步骤任务，并把过程以事件形式反馈给客户端。

两个仓库的职责边界是：

- **Agent Canvas**：负责对话、终端、浏览器、文件、设置、自动化等交互界面；维护前端状态；把用户操作转换为 Agent Server API 请求。
- **Software Agent SDK**：负责 Agent 推理循环、LLM 交互、工具定义与执行、事件模型、上下文压缩、安全确认和工作区抽象。
- **Agent Server**：把会话、工作区、事件、工具与配置通过 REST/WebSocket 暴露给 Canvas 或其他客户端。

已确认：Canvas 仓库自己的架构说明明确指出，它不负责 Agent 动作执行、工作区隔离或托管凭据；这些能力位于 Agent Server/SDK 或部署层。

## 3. 技术栈

### 3.1 Agent Canvas

| 类别 | 已确认技术 |
| --- | --- |
| 语言 | TypeScript、少量 JavaScript |
| UI | React 19、React Router 7、HeroUI |
| 构建 | Vite 8 |
| 状态与数据 | Zustand 5、TanStack Query 5 |
| 桌面端 | Electron 43 |
| 开发组件 | Monaco Editor、xterm.js |
| 接口 | OpenHands Agent Server 的 TypeScript 客户端 |
| 运行要求 | `package.json` 声明 Node `>=24`；Volta 固定 Node `24.21.0`、npm `10.5.0` |

### 3.2 Software Agent SDK

| 类别 | 已确认技术 |
| --- | --- |
| 语言 | Python 为主；另有 TypeScript 客户端 |
| Python 版本 | 各核心包声明 Python `>=3.12`；仓库类型检查配置目标为 Python 3.13 |
| 数据模型 | Pydantic |
| LLM 接入 | LiteLLM |
| MCP | FastMCP / MCP 客户端能力 |
| Agent Server | FastAPI、Uvicorn、WebSocket、SQLAlchemy |
| 代码分析 | tree-sitter |
| 工作区 | 本地、Docker、Agent Sandbox、Apptainer、远程 API、OpenHands Cloud 实现 |
| 浏览器/终端工具 | browser-use、libtmux 等 |

这些版本来自本地固定快照的 `package.json` / `pyproject.toml`，不是对所有历史版本的概括。

## 4. License

两个已纳入的官方子模块都在仓库根目录提供 **MIT License**：

- [`OpenHands/OpenHands/LICENSE`](../openhands/LICENSE)
- [`OpenHands/software-agent-sdk/LICENSE`](../software-agent-sdk/LICENSE)

边界说明：这只能确认本次克隆的两个仓库。第三方依赖、云端服务以及 OpenHands 组织下其他仓库可能有各自条款，不能由这两个 LICENSE 自动推导。

## 5. 核心能力

### 已确认事实

1. **多轮 Agent 执行**：`Agent.step()` 依据历史、上下文和工具定义向 LLM 请求下一步动作。
2. **工具调用**：将结构化工具 schema 交给 LLM，把返回的 tool call 转成动作事件，再执行并生成观察事件。
3. **会话与事件流**：会话循环维护状态、迭代次数、预算、确认请求、异常和事件历史。
4. **上下文管理**：通过 View 选取事件，通过 condenser 在超出上下文容量前压缩旧历史。
5. **持久记忆提示**：可读取用户级和项目级 `MEMORY.md`，作为附加上下文参与推理。
6. **多种工作区**：统一抽象命令执行、文件传输、Git 状态/差异等能力，并提供本地或隔离式实现。
7. **安全控制**：支持工具风险评估、用户确认、取消，以及对共享资源的并发锁定。
8. **多客户端接入**：Canvas 通过 REST/WebSocket 与 Agent Server 交互；SDK 也可独立嵌入 Python 程序。
9. **规划型预设**：SDK 提供 Planning Agent preset，通过检索工具和受限的 `PLAN.md` 编辑工具产出计划。

### 合理推测

- OpenHands 的设计重点不是预先构造一个完整、不可变的任务计划，而是让 Agent 在“模型决策 → 工具动作 → 环境观察 → 再决策”的闭环中逐步推进；Planning preset 是可选的专门配置。
- Canvas 与 Agent Server 的分离，使同一 Agent 后端可以被浏览器界面、桌面端或其他客户端复用。

### 尚未验证

- 本阶段没有安装完整依赖，也没有启动 Canvas、Agent Server、Docker 或 Agent Sandbox。
- 没有验证特定 LLM 提供商的真实调用、端到端任务成功率、隔离强度、性能或云端功能。
- 没有对所有第三方依赖做许可证与供应链审计。

## 6. 第一阶段结论

OpenHands 适合作为第一个 AI Agent 源码研究对象，因为其 Agent 核心、工具协议、上下文管理、运行环境和 UI/服务边界相对清晰。但学习时必须同时阅读 Canvas 和 Software Agent SDK；只读主仓库会遗漏真正的 Agent 循环与 Runtime 抽象。
