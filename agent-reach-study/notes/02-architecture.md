# Agent Reach 架构与核心数据流

> - 研究日期：2026-10-14
> - 官方仓库：`Panniantong/Agent-Reach`
> - submodule 快照：`94f06c1969dfc1834001269d79d3ad0972d9dee6`
> - 分析方式：人工源码阅读
> - 未安装依赖、未运行 Agent Reach、未修改官方源码

## 0. 分析边界与前提修正

### 0.1 REA 未用于本次 Agent Reach 分析

仓库当前没有 `.ts`、`.tsx`、`.js`、`.jsx`、`.mjs` 或 `.cjs` 源码，主体是 Python。REA 当前的 JavaScript/TypeScript 静态分析不能覆盖这些 Python 调用链，因此本文所有 Agent Reach 代码关系均标记为**人工源码阅读**。

OpenHands 对比使用的核心 Tool 实现也是 Python，同样是人工阅读；本阶段没有为了形式上使用 REA 而强行分析无关的前端代码。

### 0.2 源码中没有通用 `Capability` 类

用户要求中的“Capability 系统”是一个架构概念，不是当前源码中的同名类。一项完整能力实际分散在以下三处：

```text
Skill 中的意图与命令知识
        +
Channel 中的渠道、backend 顺序和健康状态
        +
上游 CLI / API / MCP Server 的真实执行能力
```

### 0.3 源码中没有通用 `Provider` / `Adapter` 插件框架

- `Channel` 最接近平台 adapter，但它主要做 URL 识别和状态检查，没有通用 `execute()`；
- channel 的 `backends` 是字符串列表，具体检查逻辑由每个 channel 内部的分支实现，不是 Provider 对象注册表；
- 只有音频转写子系统显式使用名为 `PROVIDERS` 的映射，在 Groq 和 OpenAI Whisper 之间选择。

### 0.4 “路由”不是单一运行时分发器

当前源码中：

- `Channel.can_handle()` 有实现和测试，但在生产代码中没有调用点；
- `get_channel()` 也只在测试中被调用；
- `active_backend` 被 `doctor` 输出给 Agent/用户，但 Agent Reach 不会根据它统一执行所有平台操作。

所以当前主路由模式是**指令驱动的 Agent 路由**，不是统一 SDK 调用的内部路由。

## 1. 整体架构

Agent Reach 可以分成四个层次：

```text
┌── 1. Agent 知识层 ─────────────────────────┐
│ SKILL.md + references/                               │
│ 意图分类、命令语法、失败重试、认证边界              │
└──────────────────────────────────────────────────┘
                         ↓
┌── 2. 管理与观测层 ──────────────────────┐
│ CLI + Config + Doctor + Probe                         │
│ 环境检查、安装编排、配置、状态汇总                    │
└──────────────────────────────────────────────────┘
                         ↓
┌── 3. Capability 描述层 ──────────────────┐
│ Channel registry + concrete channels + backend status │
│ 平台识别、后端顺序、环境探测、active_backend           │
└──────────────────────────────────────────────────┘
                         ↓
┌── 4. 外部执行层 ─────────────────────────┐
│ gh / yt-dlp / OpenCLI / mcporter / API / MCP Servers │
│ 真正发起请求、读取内容并返回结果                    │
└──────────────────────────────────────────────────┘
```

其中第 4 层大多不由 Agent Reach 包内的统一 executor 控制，而是由上层 Agent 读取 Skill 后直接调用上游工具。

## 2. 用户请求入口

当前存在三类入口，它们的能力并不等价。

### 2.1 Agent + Skill 入口：面向自然语言请求

文件：[`agent_reach/skill/SKILL.md`](../agent-reach/agent_reach/skill/SKILL.md)

用户向支持 Skill 的 Agent 提出“搜索这个主题”、“读这个 GitHub 仓库”或“查看某个平台的内容”时，宿主 Agent 根据 Skill 触发规则进入 Agent Reach 路由知识。

```text
用户自然语言
  → 宿主 Agent 匹配 Agent Reach Skill
  → 按意图选择 search/social/dev/web/video/finance/career
  → 对多 backend 或登录渠道先查 doctor --json
  → 根据 active_backend 和 reference 选命令
  → 宿主 Agent 直接调用上游工具
```

关键点：理解用户意图的是宿主 Agent/LLM，不是 Agent Reach Python 包。

### 2.2 CLI 入口：面向环境管理和少量运行能力

文件：[`agent_reach/cli.py`](../agent-reach/agent_reach/cli.py)

`pyproject.toml` 将 `agent-reach` 命令映射到 `agent_reach.cli:main`。`main()` 通过 `argparse` 暴露：

- `install`；
- `doctor`；
- `configure`；
- `setup`；
- `uninstall`；
- `skill`；
- `format`；
- `transcribe`；
- `check-update`；
- `watch`。

注意 CLI 没有通用的 `read` 或 `search` 命令。这与“主路径直接调上游工具”的设计一致。

### 2.3 MCP 入口：只读状态查询

文件：[`agent_reach/integrations/mcp_server.py`](../agent-reach/agent_reach/integrations/mcp_server.py)

```text
MCP Client
  → tools/list
  → get_status
  → AgentReach.doctor_report()
  → doctor.check_all()
  → TextContent
```

官方 MCP Server 目前只提供 `get_status`。它使用 `Config(read_only=True)`，不提供安装、搜索、读取、Cookie 导入或平台操作 Tool。

## 3. 核心模块结构

| 模块 | 关键类/函数 | 职责 |
|---|---|---|
| `cli.py` | `main()`, `_cmd_install()`, `_cmd_doctor()`, `_install_skill()` | 命令入口、安装编排、配置和报告 |
| `core.py` | `AgentReach` | 轻量程序门面，当前只封装 doctor |
| `config.py` | `Config` | YAML 配置、只读模式、原子写入、凭据脱敏 |
| `doctor.py` | `check_all()`, `format_report()` | 聚合 channel 状态，隔离异常并生成报告 |
| `probe.py` | `ProbeResult`, `probe_command()` | 区分 missing/broken/timeout/error/ok |
| `channels/base.py` | `Channel` | 渠道元数据、backend 顺序、URL 识别和检查协议 |
| `channels/__init__.py` | `ALL_CHANNELS`, `get_all_channels()` | 16 个 channel 的显式注册表 |
| `channels/*.py` | `TwitterChannel`, `YouTubeChannel` 等 | 平台特定的 backend 探测与配置建议 |
| `backends/opencli.py` | `OpenCLIStatus`, `opencli_status()` | 共享 OpenCLI 安装、daemon 和浏览器扩展状态 |
| `channels/mcporter.py` | `inspect_mcporter_config()` | 只读检查 mcporter 的 MCP Server 配置层 |
| `skill/` | `SKILL.md`, `references/*.md` | 宿主 Agent 的意图路由、命令和安全策略 |
| `integrations/mcp_server.py` | `create_server()`, `main()` | 以 MCP 形式暴露只读状态 |
| `transcribe.py` | `PROVIDERS`, `transcribe()` | 音频处理和 Groq/OpenAI Whisper provider 路由 |
| `utils/` | URL/path/process/text helpers | SSRF 防护、私有路径、子进程和脱敏 |

## 4. Capability 系统

### 4.1 Capability 的真实组成

当前代码中，一项“GitHub 搜索能力”或“YouTube 字幕能力”不是一个可直接调用的 Capability 对象，而是由多块信息组成：

| 组成部分 | 回答的问题 |
|---|---|
| Skill 路由表 | 用户的意图属于哪类能力？ |
| Reference 命令 | 应调用哪个命令，失败后怎样降级？ |
| Channel | 平台是什么，候选 backend 有哪些？ |
| `check()` | 当前环境中哪个 backend 有证据可用？ |
| 上游工具 | 谁真正向外部平台发请求？ |
| 宿主 Agent | 何时调用，如何理解和组合返回结果？ |

### 4.2 Channel 的能力描述

`Channel` 基类包含：

- `name`：稳定渠道标识；
- `description`：人类可读名称；
- `backends`：有序候选后端；
- `tier`：0 为零配置，1 为需要免费 key/登录，2 为复杂配置；
- `active_backend`：当前已被证明服务该渠道的后端；
- `can_handle(url)`：URL 所属平台判定；
- `ordered_backends(config)`：合并默认顺序与用户覆盖；
- `check(config)`：返回 `(status, message)`。

### 4.3 Capability 系统的当前限制

- Channel 没有统一 action schema、result schema 或 executor；
- 不同 backend 只以字符串命名，没有统一 Provider 生命周期；
- `can_handle()` 尚未进入实际自动分发链；
- 能力结果没有统一 Observation 模型；
- Skill 指令依赖宿主 Agent 正确解释和执行。

这些不一定是缺陷：它们是“Agent Reach 作为轻量能力层，不做重型 wrapper”的直接代价。

## 5. Provider / Adapter 设计

### 5.1 Channel 是检查型 Adapter，不是通用执行 Adapter

具体 channel 将平台特性封装在 `check()` 中。例如：

- `YouTubeChannel` 探测 `yt-dlp`、JS runtime 和转写准备度；
- `TwitterChannel` 按 `twitter-cli → OpenCLI → bird` 检查；
- `RedditChannel` 按 `OpenCLI → rdt-cli` 检查；
- `BilibiliChannel` 按 `bili-cli → OpenCLI → 搜索 API` 检查；
- `XiaoHongShuChannel` 按 `OpenCLI → xiaohongshu-mcp → xhs-cli` 检查。

这些类将差异性从 `doctor` 中移出，但大多不封装真实内容调用。

### 5.2 backend 是有序字符串候选集

`ordered_backends()` 的行为是：

```text
默认 backends 列表
  → 读取 <channel>_backend 配置/环境变量
  → 如果命中已知 backend，把它移到列表首位
  → 未知覆盖值被忽略
  → 返回同一组候选的新顺序
```

具体多 backend channel 再依次检查候选，通常优先返回第一个 `ok`，没有 `ok` 时才返回第一个 `warn`。

### 5.3 OpenCLI 是少数共享 backend 抽象

[`backends/opencli.py`](../agent-reach/agent_reach/backends/opencli.py) 用 `OpenCLIStatus` 表示：

- CLI 是否安装；
- 是否损坏；
- daemon 是否运行；
- 浏览器扩展是否连接；
- 磁盘上是否存在扩展文件；
- 当前版本和修复建议。

`opencli_status()` 避免运行带副作用的 `opencli doctor`，而是执行 `--version`、读取 loopback status API 并检查扩展文件证据。这个结果被 Reddit、Twitter、小红书、Facebook、Instagram 和 Bilibili 等 channel 复用。

### 5.4 转写子系统是真正的 Provider 路由

[`transcribe.py`](../agent-reach/agent_reach/transcribe.py) 定义：

```text
PROVIDERS = {
  groq:   endpoint + model + key_field,
  openai: endpoint + model + key_field
}
```

调用链：

```text
transcribe(provider="auto")
  → _provider_order()                  # groq → openai
  → 过滤出已配置 key 的 provider
  → 下载/校验/压缩/分块音频
  → _transcribe_with_fallback()
  → transcribe_chunk()
  → Whisper-compatible HTTP API
```

默认 `auto` 只使用第一个已配置 provider；只有显式 `allow_provider_fallback=True` 才允许失败后把音频发给下一个 provider。这是有意识的数据外发边界。

## 6. 状态检测流程

### 6.1 主调用链

```text
agent-reach doctor [--json]
  → cli.main()
  → _cmd_doctor(args)
  → Config(read_only=True)
  → doctor.check_all(config)
  → channels.get_all_channels()
  → for each Channel.check(config)
      → probe_command() / 只读配置检查 / 有限网络探测
      → (status, message) + active_backend
  → scrub_url_credentials(message)
  → results[channel_name]
  → JSON 或 format_report()
```

### 6.2 状态语义

| 状态 | 含义 |
|---|---|
| `ok` | 已获得该 channel 认可的可用证据 |
| `warn` | 部分安装/配置存在，但登录、连通性或真实功能未完全证明 |
| `off` | 后端缺失或没有可用候选 |
| `error` | 已安装部件损坏、探测异常或配置不可信 |

`active_backend` 并不在每个 `warn` 状态中填充。当代码刻意避免真实登录验证或 Cookie 副作用时，即使检测到已安装工具，也可保持 `active_backend = null`。

### 6.3 外部命令探测

`probe_command()` 先用 `shutil.which()` 找路径，然后实际执行无副作用的版本/状态命令，区分：

```text
PATH 不存在     → missing
命令存在但无法启动 → broken
执行超时          → timeout
非零退出          → error
零退出            → ok
```

这能识别“pipx/venv shim 仍在，但解释器已丢失”等仅用 `which()` 无法识别的情况。

### 6.4 状态边界

- `doctor` 将单个 channel 异常降级为 `error`，不让一个平台中断整份报告；
- channel 是注册表单例，异常时 `doctor` 会清除上一次的残留 `active_backend`；
- 预期消息和异常消息都经过 URL 凭据脱敏；
- 部分 channel 会做有限网络探测，所以“只读”指不写本地/不变更账号，不是完全无网络。

## 7. 安装流程

### 7.1 前提：`agent-reach install` 不是 Python 包本体的安装命令

用户必须先通过 pipx/venv 取得 `agent-reach` CLI。然后 `agent-reach install` 才检查或配置 gh、Node.js、mcporter、Exa、yt-dlp 配置和可选渠道。

### 7.2 安全模式

| 命令模式 | `Config` | 是否自动系统修改 |
|---|---|---|
| 默认 `install` | `read_only=True` | 否，safe/check-only |
| `install --safe` | `read_only=True` | 否，与默认兼容 |
| `install --dry-run` | `read_only=True` | 否，只预览 |
| `install --system` | 可写 | 是，允许系统依赖、全局工具、配置和 Skill 写入 |

### 7.3 `_cmd_install()` 调用链

```text
CLI 解析 install 参数
  → 验证 --channels 名称
  → 计算 safe_mode / dry_run
  → Config(read_only = safe || dry_run)
  → 检测 local/server 环境
  → 过滤不适用于 server 的桌面/Chrome channel
  → 如明确授权，保存 proxy
  → 核心依赖流程
      safe:   _install_system_deps_safe()
      dry:    _install_system_deps_dryrun()
      system: _install_system_deps()
  → mcporter / Exa 流程
      safe:   _install_mcporter_safe()
      system: _install_mcporter()
  → system 模式安装显式请求的可选 channel
  → 对 Cookie channel 只打印显式配置指南
  → check_all(config)
  → format_report(results)
  → 仅 system 实装路径调用 _install_skill()
  → 任一必要步骤失败则退出码 1
```

### 7.4 安装的写入面

`--system` 可以导致：

- Linux `apt-get` 或 macOS Homebrew 安装；
- npm 全局安装 `undici`、`mcporter` 或可选工具；
- `mcporter config add exa ... --scope home`；
- `yt-dlp` 用户配置写入；
- `~/.agent-reach/tools/` 和 `~/.agent-reach/config.yaml`；
- 各 Agent 客户端的 Skill 目录。

这些都是为什么本次不能运行安装器。即使默认 safe 模式在源码和测试中定义为不写入，本阶段仍只做静态阅读。

## 8. 路由逻辑

Agent Reach 的路由可分为三层。

### 8.1 第一层：意图路由

位置：`skill/SKILL.md` 及 `references/`。

```text
用户请求
  → search / social / career / dev / web / video / finance
  → 读取相应 reference
```

这一层由宿主 Agent 解释 Markdown 规则完成，不是 Python 函数调度。

### 8.2 第二层：backend 健康路由

位置：`Channel.backends`、`ordered_backends()` 和具体 `check()`。

```text
平台 channel
  → 默认 backend 顺序
  → 用户覆盖可将已知 backend 移到前面
  → 依次检查候选
  → 优先选首个 ok，其次是 warn
  → doctor 输出 active_backend / 修复建议
```

这一层主要是“观测与建议”，不是真正内容请求的统一分发。

### 8.3 第三层：执行路由

宿主 Agent 将 doctor 状态和 reference 命令组合起来，直接执行：

```text
gh search ...
yt-dlp ...
opencli <platform> ...
mcporter call <server.tool> ...
curl https://r.jina.ai/...
```

结果直接回到宿主 Agent。Agent Reach Python 包通常不在数据返回路径中，不统一将结果转换为某种 `Observation`。

### 8.4 一次内容请求的完整数据流

```text
用户：“帮我查这个平台的内容”
  → 宿主 Agent/LLM 识别意图
  → 加载 Agent Reach Skill
  → 必要时运行 doctor --json
  → doctor 产生 status/backends/active_backend
  → 宿主 Agent 根据 Skill 和状态选命令
  → Shell/MCP Client 调用上游 backend
  → 上游 backend 请求外部平台
  → 结果返回 Shell/MCP Client
  → 宿主 Agent 解释、合并和回答
```

这里有两个 LLM/Agent 责任不属于 Agent Reach：

1. 选择是否应调用工具；
2. 理解工具结果并决定下一步。

## 9. 与 OpenHands Agent Tool 系统的区别

对比依据：Agent Reach 当前 Python 快照，以及本地 OpenHands Software Agent SDK 的 `ToolDefinition`、`ToolExecutor`、`ActionEvent` 和 `ObservationEvent`。OpenHands 详细研究参见 [`openhands-study/notes/06-tool-system.md`](../../openhands-study/notes/06-tool-system.md)。

| 维度 | Agent Reach | OpenHands Tool 系统 |
|---|---|---|
| 主要定位 | 能力选型、安装、健康检查与路由知识 | Agent 执行循环中的正式 Tool 协议 |
| 能力定义 | Skill + Channel + 上游命令 | `ToolDefinition` + Action/Observation schema + Executor |
| 工具发现 | Agent 读 Skill/reference，doctor 输出状态 | Tool registry/runtime tools 生成 LLM tool schema |
| 输入 schema | 多数是 Markdown 中的 CLI 命令语法 | Pydantic/JSON schema，进入 LLM function calling |
| 执行 | 宿主 Agent 通过 Shell/MCP 直接调上游 | `ToolDefinition.__call__()` 进入 `ToolExecutor` |
| 输出 | 上游命令原始文本/JSON | 强类型 `Observation` |
| 事件链 | 无统一 Action/Observation Event | `ActionEvent → Tool → ObservationEvent` |
| 下一轮 LLM | 由宿主 Agent 自己处理 | `ObservationEvent.to_llm_message()` 正式回流 |
| Workspace | 不是核心抽象，Skill 要求不污染 Workspace | Tool 可从 Conversation State 取 Workspace |
| 并发/资源锁 | 无通用模型 | OpenHands 具有并发执行和工具资源约束 |
| 风险审批 | 主要依赖 Skill 规则和 CLI 模式 | ActionEvent 可携带 security risk，并进入会话审批链 |

### 9.1 两者如何组合

一个合理但未动态验证的组合是：

```text
OpenHands Agent
  → OpenHands Terminal Tool / MCP Tool
  → Agent Reach Skill 提供的上游命令或 MCP 路由
  → 外部平台
  → TerminalObservation / MCPToolObservation
  → OpenHands ObservationEvent
  → 下一轮 LLM
```

这里 Agent Reach 可以提供“用什么工具、怎样调”的知识；OpenHands 仍负责事件、执行、Observation、Workspace 和 LLM 反馈循环。

### 9.2 未验证的集成问题

- OpenHands 现有 Skill 加载路径是否能直接安装 Agent Reach Skill；
- OpenHands Runtime 镜像是否包含 Python、Node.js、gh、mcporter 和各上游 CLI；
- 容器内浏览器会话、Cookie 和本地回环服务的持久化方式；
- 哪些 Agent Reach 命令需在 OpenHands 中标记为需审批或高风险。

## 10. 与 MCP 的关系

### 10.1 Agent Reach 作为 MCP Server

`integrations/mcp_server.py` 使用 Python MCP SDK 启动 stdio Server，但只注册：

```text
Tool: get_status
Input: empty object
Output: doctor_report() 的文本
```

这是观测面 Tool，不是平台内容 Tool。

### 10.2 Agent Reach 作为 MCP 配置与调用引导层

Exa 和 xiaohongshu-mcp 等外部服务由 `mcporter` 调用。Agent Reach：

- 可在获得 `--system` 授权后安装 `mcporter`；
- 可添加 Exa MCP Server 配置；
- `inspect_mcporter_config()` 以只读方式识别已配置 server name；
- Skill 告诉 Agent 如何执行 `mcporter call ...`。

这里 Agent Reach 不是 MCP Client 协议实现本身；`mcporter` 才是实际客户端/调用层。

### 10.3 与标准 MCP Tool 模型的区别

| 维度 | Agent Reach Skill/Channel | MCP Tool |
|---|---|---|
| 发现 | Markdown 规则 + doctor 状态 | Client 从 Server 运行时 `list_tools` |
| 输入 | CLI 命令语法和自然语言指南 | JSON Schema |
| 调用 | 宿主 Agent/Shell 执行 | Client 按 Tool name + arguments 调用 |
| 返回 | 上游命令自定义文本/JSON | MCP content blocks / structured content |
| 生命周期 | 主要由宿主 Agent 管理 | MCP Client/Server 连接与能力发现 |

### 10.4 正确的 MCP 边界图

```text
                         ┌→ Agent Reach MCP Server ─→ get_status only
宿主 Agent / MCP Client ─┤
                         └→ mcporter ─→ Exa / xiaohongshu MCP Server ─→ 外部数据

另一条非 MCP 路径：

宿主 Agent / Shell ─→ gh / yt-dlp / OpenCLI / 平台 CLI ─→ 外部数据
```

所以“Agent Reach 支持 MCP”是事实，但“Agent Reach 已经是完整的多平台 MCP Gateway”不是当前官方源码可支持的结论。

## 11. 三条核心数据流总结

### 11.1 状态流

```text
CLI/MCP get_status
  → read-only Config
  → Channel Registry
  → Channel.check()
  → Probe / local config evidence / limited network evidence
  → status + message + active_backend
  → credential scrubbing
  → JSON / Rich report / MCP TextContent
```

### 11.2 安装流

```text
用户明确选择模式
  → validate channels
  → detect environment
  → core dependencies
  → mcporter + Exa
  → optional channel installers
  → explicit cookie guidance
  → doctor verification
  → system mode only: copy Skill
```

### 11.3 内容获取流

```text
用户
  → 宿主 Agent/LLM
  → Agent Reach Skill + doctor state
  → Shell or MCP Client
  → upstream tool/server
  → external platform
  → raw result
  → 宿主 Agent/LLM 解释
  → 用户
```

第三条是理解 Agent Reach 最重要的数据流：**Agent Reach 多数时候不在内容数据的实时中转路径上。**

## 12. 事实、推测、建议与未验证项

### 已确认事实

- Agent Reach 主体是 Python，当前快照不包含 TypeScript/JavaScript 源码；
- 仓库没有通用 `Capability`、`Provider` 或 `Adapter` 基类；
- `Channel` 是健康检查和 backend 描述抽象，不是通用 Tool executor；
- `can_handle()` 与 `get_channel()` 当前没有生产调用点；
- 默认 `agent-reach install` 是 safe/check-only，`--system` 才开放系统修改；
- `doctor` 使用只读 Config，并聚合 16 个 channel；
- 官方 Agent Reach MCP Server 只提供 `get_status`；
- 实际平台调用大多由宿主 Agent 直接执行上游工具。

### 合理推测

- 这种“Skill + doctor + direct upstream call”设计能减少包装层，但将更多正确性责任交给宿主 Agent；
- 如果与 OpenHands 结合，Agent Reach 最适合提供路由知识和环境状态，而 OpenHands 保留工具执行、审批和 Observation 闭环；
- 如果未来要跨 Agent 平台提供更强的统一能力，需要为平台操作定义正式 schema 和 executor，或扩展为内容级 MCP Tools。

### 主观建议

- 继续学习时，先研究“状态可信度”，不要立即安装所有 backend；
- 将 `ok`、`warn` 和 `active_backend=null` 当作不同证据级别，不要把“已发现命令”等同于“平台功能已验证”；
- 未来做 OpenHands 集成时，先选无 Cookie、无登录、只读渠道，并将 Shell 命令记录为明确 Tool Observation。

### 未验证信息

- 当前 Windows 机器上各 channel 的 doctor 结果；
- 任何实际平台内容获取路径；
- `--system` 在本机的真实写入与兼容性；
- Agent Reach Skill 与 OpenHands Skill/Plugin 的直接兼容性；
- OpenHands 容器中的浏览器、Cookie、回环 MCP Server 和凭据隔离；
- 可选 MCP Server 与真实 MCP Client 的连接行为。

## 13. 关键源码索引

| 主题 | 文件 | 类/函数 |
|---|---|---|
| CLI 入口 | [`agent_reach/cli.py`](../agent-reach/agent_reach/cli.py) | `main()` |
| 安装编排 | [`agent_reach/cli.py`](../agent-reach/agent_reach/cli.py) | `_cmd_install()`, `_install_system_deps()`, `_install_mcporter()` |
| Skill 安装 | [`agent_reach/cli.py`](../agent-reach/agent_reach/cli.py) | `_install_skill()` |
| 核心门面 | [`agent_reach/core.py`](../agent-reach/agent_reach/core.py) | `AgentReach` |
| 配置 | [`agent_reach/config.py`](../agent-reach/agent_reach/config.py) | `Config` |
| 状态聚合 | [`agent_reach/doctor.py`](../agent-reach/agent_reach/doctor.py) | `check_all()`, `format_report()` |
| 命令探测 | [`agent_reach/probe.py`](../agent-reach/agent_reach/probe.py) | `ProbeResult`, `probe_command()` |
| Channel 协议 | [`agent_reach/channels/base.py`](../agent-reach/agent_reach/channels/base.py) | `Channel`, `ordered_backends()` |
| Channel 注册 | [`agent_reach/channels/__init__.py`](../agent-reach/agent_reach/channels/__init__.py) | `ALL_CHANNELS`, `get_all_channels()` |
| OpenCLI backend | [`agent_reach/backends/opencli.py`](../agent-reach/agent_reach/backends/opencli.py) | `OpenCLIStatus`, `opencli_status()` |
| MCP 配置检查 | [`agent_reach/channels/mcporter.py`](../agent-reach/agent_reach/channels/mcporter.py) | `inspect_mcporter_config()` |
| 状态 MCP Server | [`agent_reach/integrations/mcp_server.py`](../agent-reach/agent_reach/integrations/mcp_server.py) | `create_server()`, `get_status` |
| 转写 provider | [`agent_reach/transcribe.py`](../agent-reach/agent_reach/transcribe.py) | `PROVIDERS`, `transcribe()`, `_transcribe_with_fallback()` |
| Agent 路由知识 | [`agent_reach/skill/SKILL.md`](../agent-reach/agent_reach/skill/SKILL.md) | 路由表、状态检查、安全规则 |
| OpenHands Tool 抽象 | [`tool.py`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/tool/tool.py) | `ToolDefinition`, `ToolExecutor` |
| OpenHands Action | [`action.py`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/event/llm_convertible/action.py) | `ActionEvent` |
| OpenHands Observation | [`observation.py`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/event/llm_convertible/observation.py) | `ObservationEvent` |
| OpenHands MCP Tool | [`mcp/tool.py`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/mcp/tool.py) | `MCPToolExecutor` |
