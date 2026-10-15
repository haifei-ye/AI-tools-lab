# MCP 研究

本目录用于系统研究 [Model Context Protocol（MCP）](https://modelcontextprotocol.io/) 在 AI Agent 生态中的作用，并把协议概念与本仓库已有的 OpenHands、Agent Reach 和 REA 研究连接起来。

## 项目介绍

MCP 是连接 LLM 应用与外部数据、工具和工作流的开放协议。它定义 Host、Client、Server 之间如何交换 JSON-RPC 消息，并把 Server 能力组织成 Tool、Resource 和 Prompt 等标准原语。

MCP 本身不是 Agent、LLM、权限沙箱或完整应用框架。它解决的是互操作边界；规划、用户确认、权限控制、Runtime 隔离、结果可信度和业务语义仍由 Host 与具体实现负责。

本研究以官方规范、reference servers 和 TypeScript SDK 的固定源码快照为基础，先完成静态源码研究，再逐步进行受控实验。第五、七阶段主要记录设计和静态调用链；第六阶段真实验证 TypeScript MCP Client/Server 协议层；第八阶段在独立 Ubuntu 环境真实验证 OpenHands Agent Layer 经 Python FastMCP Client 调用 TypeScript MCP Server。全部实验均未连接真实账号或外部业务服务。

## 目录结构

```text
mcp-study/
├── README.md
├── .gitignore
├── notes/
│   ├── 01-overview.md
│   ├── 02-architecture.md
│   ├── 03-filesystem-server.md
│   ├── 04-client-sdk.md
│   ├── 05-first-server.md
│   ├── 06-first-server-result.md
│   ├── 07-openhands-integration.md
│   └── 08-openhands-agent-test-result.md
├── clients/
│   └── typescript-sdk/         # 官方 TypeScript SDK submodule
└── servers/
    ├── modelcontextprotocol/   # 官方规范、schema 和文档 submodule
    ├── official-servers/       # 官方 reference servers submodule
    └── project-info-server/    # 本地最小 TypeScript Server 实验
```

`servers/` 是本学习模块统一存放 MCP 官方源码快照和未来受控 Server 样例的位置。`clients/` 存放官方 Client SDK 快照。`modelcontextprotocol` 是**规范与文档仓库**，不是可直接启动的 Server；`official-servers` 保存 Filesystem 等官方参考实现，官方明确说明它们是教育性 reference implementation，而不是未经评估即可投入生产的产品。

## 官方源码快照

| 用途 | 仓库 | 固定提交 | 研究对象 |
|---|---|---|---|
| 协议规范 | `modelcontextprotocol/modelcontextprotocol` | `5ea996028df322ce97d1c906731cf8c05a6e268e` | 正式规范 `2026-07-28` 与历史版本 |
| Server 实现 | `modelcontextprotocol/servers` | `bbb701e7ac1e57f3edd1c2836b94c5457eaf7b9c` | `src/filesystem` TypeScript reference server |
| Client SDK | `modelcontextprotocol/typescript-sdk` | `9bc40e903fde15534ec06ff4c1347d47000dbe16` | `@modelcontextprotocol/client@2.3.1`、Transport 与协议协商 |

克隆主仓库后取得 submodule：

```bash
git submodule update --init --recursive
```

不需要安装依赖即可阅读 `README.md`、`docs/` 和 `schema/`。官方仓库的构建要求不等于本学习阶段的运行要求。

## 学习路线

| 阶段 | 主题 | 产物 | 证据类型 | 状态 |
|---|---|---|---|---|
| 1 | MCP 定位、核心原语和生态关系 | [`notes/01-overview.md`](notes/01-overview.md) | 官方规范与源码静态研究 | 已完成 |
| 2 | Host/Client/Server、生命周期、能力发现、调用链与 Transport | [`notes/02-architecture.md`](notes/02-architecture.md) | 官方规范与源码静态研究 | 已完成 |
| 3 | Filesystem MCP Server：Tool、Roots、文件权限与执行边界 | [`notes/03-filesystem-server.md`](notes/03-filesystem-server.md) | reference server 静态研究 | 已完成 |
| 4 | 官方 TypeScript SDK Client：连接、协商、`tools/list` 与 `tools/call` | [`notes/04-client-sdk.md`](notes/04-client-sdk.md) | SDK 静态研究 | 已完成 |
| 5 | 最小 TypeScript MCP Server：固定数据 Tool 与实验设计 | [`notes/05-first-server.md`](notes/05-first-server.md) | 自建源码与静态设计 | 已完成 |
| 6 | 自建 Server 的 Client/Server 协议实验 | [`notes/06-first-server-result.md`](notes/06-first-server-result.md) | TypeScript 真实运行 | PASS |
| 7 | OpenHands MCP 配置、Tool 适配和 Action/Observation 调用链 | [`notes/07-openhands-integration.md`](notes/07-openhands-integration.md) | OpenHands 源码静态研究 | 已完成 |
| 8 | OpenHands Agent Layer 调用自建 MCP Server | [`notes/08-openhands-agent-test-result.md`](notes/08-openhands-agent-test-result.md) | Python Agent + TypeScript Server 真实运行 | PASS |

第二阶段以当前正式规范 `2026-07-28` 为主，并单独对照 `2025-11-25`：当前版本已经移除 `initialize → initialized` 会话握手，改为每个请求携带协议版本与 Client capabilities。旧握手只作为兼容与历史实现研究，不能当作当前生命周期。

第四阶段补充了一个重要实现边界：TypeScript SDK v2 支持 `2026-07-28`，但手工创建的 `Client` 默认仍运行 2025-era `initialize`；新一代 `server/discover` 必须通过 `versionNegotiation` 显式启用。规范的当前行为与 SDK 的兼容默认值不能混为一谈。

第五阶段保留了运行前的设计与未验证边界；第六阶段随后安装锁定的本地实验依赖并真实执行同进程 TypeScript Client/Server harness，验证 `server/discover`、`tools/list`、`tools/call` 和 `CallToolResult`。因此第五阶段中的“待验证”是当时状态，实际运行结论以第六阶段记录为准。

第七阶段从 OpenHands Software Agent SDK 源码确认 MCP 配置、Tool 转换、ActionEvent 和 ObservationEvent 路径，但当时没有满足 Python 依赖门禁，因此没有把静态调用链写成运行成功。第八阶段在独立 Ubuntu 电脑完成锁定依赖安装和真实 Agent 实验，补齐这一证据缺口。

## 静态研究与实际实验

| 范围 | 阶段 | 能证明什么 | 不能单独证明什么 |
|---|---|---|---|
| 静态研究 | 1–5、7 | 协议定义、源码结构、注册方式、预期调用关系、安全边界 | 依赖可安装、跨语言兼容、运行时事件确实发生 |
| MCP 协议实验 | 6 | TypeScript Client 能发现并调用自建 TypeScript Server，结果符合断言 | OpenHands Agent 是否能发现、选择和消费该 Tool |
| Agent 集成实验 | 8 | OpenHands Agent/TestLLM 经 Python FastMCP Client 调用 TypeScript stdio Server，并把结果转换为 Observation 后继续循环 | 真实 LLM 的 Tool 选择质量、生产环境稳定性和完整 Runtime 隔离 |

静态阅读和实际运行是互补证据。源码能解释“为什么应当这样工作”，而实验只能确认“在记录的固定版本和受控条件下确实这样工作”；两者都不能自动外推到其他版本或生产环境。

## 实际实验成果

### TypeScript MCP 协议层

第六阶段使用自建 [`project-info-server`](servers/project-info-server/) 完成：

```text
TypeScript MCP Client
→ server/discover
→ tools/list
→ get_project_info
→ tools/call
→ CallToolResult
```

安装、类型检查、modern negotiation、Tool 发现、Tool 调用和结果断言全部通过。实验使用 injected `fetch` 的同进程 harness，不监听端口，也不把 `http://test.local` 当作真实外部地址访问。

### OpenHands Python → TypeScript 跨语言调用

第八阶段在独立 Ubuntu 电脑完成：

```text
OpenHands Agent / TestLLM
→ MCPToolDefinition
→ ActionEvent（MCPToolAction）
→ Python FastMCP Client
→ TypeScript project-info-server（stdio）
→ get_project_info
→ MCPToolObservation
→ ObservationEvent
→ 下一轮 TestLLM
→ Conversation FINISHED
```

实际结果为 `PASS`，Agent 状态为 `FINISHED`。这确认了 OpenHands SDK `1.54.0`、FastMCP `3.2.0` 与当前 TypeScript Server 之间的受控跨语言调用链，而不只是 MCP 协议层的直接 Client 测试。

Ubuntu 实验环境：

| 项目 | 固定值 |
|---|---|
| OS | Ubuntu 24.04.4 LTS x86_64 |
| Python | 3.12.3，独立虚拟环境 |
| OpenHands SDK | 1.54.0 |
| FastMCP | 3.2.0 |
| Python MCP SDK | 1.28.1 |
| Node.js | 24.18.0 Linux x64，独立目录 |
| npm | 11.16.0 |
| Software Agent SDK commit | `7bd668c9ab74f62c85745cd95adb503f53e7228b` |

没有修改 Ubuntu 系统 Python 或持久修改系统 PATH，也没有启动完整 OpenHands 生产环境。

### 实验限制

- `TestLLM` 使用预先脚本化的两次响应，Tool 选择是确定性的；本实验没有验证真实 LLM 是否能稳定选择正确 Tool。
- `get_project_info` 只接收空对象并返回固定 JSON；它不读取文件、不访问网络、不读取环境变量，也不代表复杂 Tool 的错误处理、权限控制或副作用管理。
- 实验只覆盖一个本地 stdio Server、一个 Tool 和单次成功调用；没有覆盖多 Server、多 Tool、HTTP/SSE、超时、断线重连或并发。
- `FINISHED` 证明本次受控 Conversation 正常完成，不等于完整 OpenHands Agent Server、Web、Runtime 或生产部署已经通过验证。
- 实验未使用真实 LLM API、账号、Token、Cookie、GitHub、Binance 或其他外部业务服务。

## 自建 Server 与依赖边界

`servers/project-info-server/` 的可提交源码由 `package.json`、`package-lock.json`、`tsconfig.json`、README 和三个 TypeScript 源文件组成。`package-lock.json` 应与源码一起提交，用于固定第六、八阶段已经验证过的 npm 依赖图；`node_modules/` 只是本地安装产物，必须继续忽略。

## 与 AI-tools-lab 其他研究模块的关系

| 模块 | 主要职责 | 与 MCP 的关系 |
|---|---|---|
| OpenHands | Agent 循环、Tool、事件、Workspace 和 Runtime | 可作为 MCP Host/Client，把外部 MCP Tool 适配为 OpenHands `ToolDefinition` 并放入 Action/Observation 循环。 |
| Agent Reach | 外部信息能力的 Skill、状态检测和 backend 路由 | 把 MCP/mcporter 用作部分渠道的接入方式；Agent Reach 决定“用哪种能力”，MCP规范“如何交换能力调用”。 |
| REA | 逆向工程与静态分析能力、Evidence 语义 | REA 可作为 stdio MCP Server 向 Agent 暴露分析工具，也可连接部分外部 MCP provider。 |
| MCP 研究 | 协议、原语、版本、传输和安全边界 | 为前三个模块提供统一的协议层心智模型，帮助区分协议能力与宿主实现责任。 |

一个简化关系图：

```text
OpenHands / 其他 Agent Host
  └─ MCP Client
       ├─ REA MCP Server：代码与制品分析能力
       ├─ Agent Reach 选择的外部 MCP Server：搜索/平台能力
       └─ 其他受信任 MCP Server

REA 还可以离线分析相关 TypeScript/JavaScript 源码；
它不是 MCP 连接、调用或权限控制的替代品。
```

## 研究原则

- 优先以固定官方规范、schema 和本地源码为 Evidence；
- 区分 MCP 规范事实、具体 SDK/Host 实现、架构推测和未验证内容；
- 不把 Tool 描述、annotations 或 Server 返回内容视为可信安全证明；
- 未经明确授权，不安装依赖、不启动 Server、不连接账号、不导入 Token/Cookie；
- 不修改 submodule，不提交 `node_modules`、虚拟环境、缓存、raw output 或本地密钥。
