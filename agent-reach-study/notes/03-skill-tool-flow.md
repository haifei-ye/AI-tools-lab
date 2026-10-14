# Agent Reach Skill、Channel 与外部工具调用流程

> - 研究日期：2026-10-14
> - Agent Reach submodule：`94f06c1969dfc1834001269d79d3ad0972d9dee6`
> - 源码声明版本：`1.5.0`
> - 分析方式：人工源码阅读
> - 未安装依赖、未运行项目、未修改官方源码

## 0. 分析方法与前提修正

### 0.1 为什么没有使用 REA

Agent Reach 当前快照不包含 TypeScript/JavaScript 源码，主体是 Python 与 Markdown Skill。REA 当前的 JavaScript/TypeScript 分析无法覆盖：

- Python `Channel` 类和 `doctor` 调用链；
- Python CLI 安装与配置流程；
- Markdown Skill 中的意图路由和命令规则；
- Python MCP Server 与 mcporter 配置检查。

因此，本文的 Agent Reach 代码结论均来自**人工源码阅读**。OpenHands Tool System 对比同样使用其 Python SDK 源码与已完成的本地研究笔记。

### 0.2 Skill、Channel 和 Tool 不是同一类对象

需要先区分三个概念：

| 概念 | 当前实现 | 职责 |
|---|---|---|
| Skill | Markdown frontmatter + 路由表 + reference 文档 | 告诉宿主 Agent 何时使用、用什么命令、如何降级 |
| Channel | Python `Channel` 子类 | 描述平台、候选 backend 和当前健康状态 |
| 外部 Tool | `gh`、`yt-dlp`、OpenCLI、`mcporter`、平台 CLI/API | 真正向外部系统发请求并返回结果 |

Skill 不是可执行代码，Channel 不是通用 Tool Executor，外部 Tool 也不由 Agent Reach 统一包装。

## 1. Skill 的组织方式

### 1.1 目录结构

```text
agent_reach/skill/
├── SKILL.md                 # 默认中文版
├── SKILL_en.md              # 英文版
└── references/
    ├── search.md             # Exa 搜索
    ├── social.md             # 社交/社区多 backend 路由
    ├── career.md             # LinkedIn / Boss直聘
    ├── dev.md                # GitHub CLI
    ├── web.md                # Jina Reader / Web Reader MCP / RSS
    ├── video.md              # YouTube / B站 / 小宇宙
    └── finance.md            # 雪球
```

### 1.2 `SKILL.md` 的分层内容

[`SKILL.md`](../agent-reach/agent_reach/skill/SKILL.md) 可分成七层：

1. **YAML frontmatter**：`name`、触发描述和 homepage；
2. **常驻规则**：体检、声明 backend、失败重试、多平台调研和版本提醒；
3. **路由表**：把用户意图分类到 search/social/career/dev/web/video/finance；
4. **零配置快速命令**：Exa、Jina Reader、GitHub、YouTube、V2EX、B站；
5. **登录态平台边界**：Twitter、Reddit、小红书、Facebook、Instagram、Boss直聘；
6. **环境检查与 adapter 发现**：`doctor --json`、`opencli list`、`opencli <site> --help`；
7. **按需引用**：复杂任务再读相应 `references/*.md`。

这是一种“主文件保留全局规则，reference 按领域延迟加载”的组织方式。

### 1.3 Skill 安装流程

函数：[`_install_skill()`](../agent-reach/agent_reach/cli.py)

```text
_install_skill()
  → 根据 AGENT_REACH_LANG / LC_* / LANG 选 SKILL.md 或 SKILL_en.md
  → 枚举已存在的 Skill 根目录
      ~/.agents/skills
      ~/.config/opencode/skills
      ~/.openclaw/skills
      ~/.claude/skills
      $OPENCLAW_HOME/.openclaw/skills
  → 复制本地化后的 SKILL.md
  → 复制整个 references/ 目录
  → 没有已知根目录时，默认创建 ~/.agents/skills/agent-reach
```

完整 `install --system` 在最后运行 `_install_skill()`；也可以通过 `agent-reach skill --install` 单独执行。默认 safe install 不会复制 Skill。

### 1.4 Skill 的本质限制

Skill 是对宿主 Agent 的文本指令，它不能自己保证：

- 宿主 Agent 一定先运行 doctor；
- Agent 一定按 reference 的重试顺序；
- 命令一定只读；
- 外部结果一定被正确验收；
- Agent 一定遵守凭据与安装授权边界。

**已确认的内部不一致：** Skill frontmatter 将自己描述为主要负责互联网内容获取，并将写操作列为非目标；但 `references/dev.md` 同时列出 `gh repo create`、`gh issue create`、`gh pr create`、`gh release create` 等会修改 GitHub 外部状态的命令。这些命令的存在不等于获得了用户授权；宿主 Agent 仍必须独立做变更类操作的意图与权限检查。

## 2. Channel 状态如何管理

### 2.1 注册表使用进程内单例

[`channels/__init__.py`](../agent-reach/agent_reach/channels/__init__.py) 在模块导入时直接实例化 16 个 channel：

```python
ALL_CHANNELS = [
    GitHubChannel(),
    TwitterChannel(),
    # ...
    ExaSearchChannel(),
    WebChannel(),
]
```

`get_all_channels()` 返回这个实例列表，而不是每次新建 channel。

### 2.2 Channel 内部状态

[`Channel`](../agent-reach/agent_reach/channels/base.py) 中有两类状态：

**相对稳定的类元数据：**

- `name`；
- `description`；
- `backends`；
- `tier`。

**随检查变化的运行时状态：**

- `active_backend`。

具体 `check()` 通常在开始时将 `active_backend = None`，只在 backend 被证明为 `ok` 时写入它。

### 2.3 状态是三层的

| 状态层 | 保存位置 | 持久性 |
|---|---|---|
| Agent Reach 配置 | `~/.agent-reach/config.yaml` 或环境变量 | 持久/进程级 |
| Channel 检查结果 | `status/message/active_backend` | 当次报告 + 进程内暂态 |
| 上游工具状态 | CLI 安装、外部配置、浏览器会话、MCP Server | Agent Reach 之外 |

Agent Reach 没有对话级 EventLog，也不会保存每次工具调用的 Action/Result 历史。

### 2.4 `doctor` 的聚合状态

[`doctor.check_all()`](../agent-reach/agent_reach/doctor.py) 顺序遍历 `ALL_CHANNELS`：

```text
Channel.check(config)
  → status, message
  → 读取 channel.active_backend
  → 脱敏 message 中的 URL 凭据
  → results[channel.name] = {
       status, name, message, tier, backends, active_backend
     }
```

单个 channel 抛异常时，`check_all()` 把它转换为 `status="error"`，并将 `active_backend` 强制设为 `None`，防止上一次单例状态泄漏进本次结果。

### 2.5 状态管理的潜在约束

**合理推测：** `ALL_CHANNELS` 是共享可变实例，`active_backend` 会被检查流程修改。当前 `check_all()` 是顺序执行，所以单次 CLI 路径没有并发写冲突；但如果未来在长运行服务中并发调用 `check_all()`，共享 `active_backend` 可能需要隔离或锁。本阶段未做并发实验，不将这一点表述为已确认 bug。

## 3. backend 选择流程

### 3.1 候选顺序

`Channel.backends` 是有序字符串列表。例如：

```text
Twitter:    twitter-cli → OpenCLI → bird CLI (legacy)
Reddit:     OpenCLI → rdt-cli
Bilibili:   bili-cli → OpenCLI → B站搜索 API
XiaoHongShu: OpenCLI → xiaohongshu-mcp → xhs-cli
```

### 3.2 用户覆盖

`ordered_backends(config)` 读取：

```text
<channel>_backend
```

例如 `twitter_backend=bird`。如果配置值匹配已知 backend，该 backend 被移到列表首位；未知值被忽略，不会删除原有候选。

### 3.3 多 backend channel 选择算法

Twitter、Reddit、Bilibili 和小红书等 channel 采用相似流程：

```text
active_backend = None
  → for backend in ordered_backends(config)
      → 调用 backend 特定检查函数
      → 未安装的候选返回 None，不进入 findings
      → 其他候选收集为 (backend, status, message)
  → 扫描第一个 ok
      → active_backend = backend
  → 如果没有 ok，扫描第一个 warn
      → active_backend 保持 None
  → 如果只剩损坏候选，返回 error
  → 没有候选时返回 off/warn + 安装指南
```

这里的选择是**健康检查选择**，不是一次真实搜索请求在后端之间自动切换。

### 3.4 `warn` 不等于已选中

对登录态平台，代码会刻意不执行可能自动读 Cookie、刷新凭据或产生其他副作用的 status 命令。因此可能出现：

```json
{
  "status": "warn",
  "backends": ["OpenCLI", "rdt-cli"],
  "active_backend": null
}
```

这表示“找到了部分环境证据，但没有证明内容功能可用”，宿主 Agent 应运行 reference 中的只读验收命令，不能直接宣称成功。

## 4. 外部工具调用路径

### 4.1 主路径：宿主 Agent 直接调上游工具

```text
用户请求
  → 宿主 Agent 匹配 Agent Reach Skill
  → Skill 选择 reference
  → 必要时执行 agent-reach doctor --json
  → Agent 根据 active_backend/指南选命令
  → 宿主 Shell Tool 执行上游 CLI
  → 上游 CLI 请求外部平台
  → stdout/stderr/exit code 回到宿主 Agent
  → Agent 验收非空结果并继续推理
```

例如：

| 能力 | 真实执行者 | 典型命令 |
|---|---|---|
| GitHub 搜索 | GitHub CLI | `gh search repos ...` |
| YouTube 字幕 | yt-dlp | `yt-dlp --write-sub ...` |
| 桌面小红书 | OpenCLI | `opencli xiaohongshu search ...` |
| Twitter | twitter-cli/OpenCLI | `twitter search ...` / `opencli twitter ...` |
| B站 | bili-cli/OpenCLI/API | `bili search ...` |
| 网页读取 | Jina Reader | `curl https://r.jina.ai/...` |
| Exa | mcporter + Exa MCP | `mcporter call exa.web_search_exa ...` |

Agent Reach Python 包通常不会拦截或转换上述输出。

### 4.2 包内的少量直接处理路径

并非所有调用都绕过 Agent Reach Python 代码：

- `agent-reach transcribe` 进入 `transcribe.py`，下载/处理音频后调 Groq/OpenAI Whisper；
- `agent-reach format xhs` 读 stdin JSON，经 `format_xhs_result()` 减少冗余字段；
- `WebChannel.read()` 可在 Python API 中通过 Jina Reader 读页面，但当前 Skill 主路径是直接 `curl`。

因此准确说法是：**多数外部工具由 Agent 直调，Agent Reach 只对少量特定流程提供程序包装。**

### 4.3 执行结果的责任归属

Skill 多处要求不要只看退出码，还要确认存在非空、有意义的字段。但这个验收不是 `Channel.check()` 统一执行的，而是由宿主 Agent 根据 reference 完成。

## 5. mcporter 在系统中的作用

### 5.1 定位

`mcporter` 是 Agent Reach 选用的**外部 MCP Client/CLI 桥接工具**。它不是 Agent Reach Python 包的内部模块，也不是 Agent Reach 自己的 MCP Server。

它承担三项职责：

1. 保存/解析外部 MCP Server 配置；
2. 建立到 remote HTTP 或 local stdio/HTTP Server 的连接；
3. 将 shell 命令中的 tool name 和命名参数转成 MCP tool call，并把结果输出到 stdout。

第 2、3 项是基于 Agent Reach 中的 `mcporter config/call` 使用方式得出的架构结论；本阶段没有将 mcporter 源码纳入 submodule，因此不对它的内部传输实现作更细的确认。

### 5.2 Agent Reach 对 mcporter 做了什么

**安装阶段：**

```text
_install_mcporter()
  → shutil.which("mcporter")
  → 不存在时，在 --system 路径运行 npm install -g mcporter
  → mcporter config list --json
  → 如缺少 exa，执行
     mcporter config add exa https://mcp.exa.ai/mcp --scope home
```

**只读状态阶段：**

[`channels/mcporter.py`](../agent-reach/agent_reach/channels/mcporter.py) 不启动 `mcporter`，而是直接读取配置层：

```text
MCPORTER_CONFIG 显式路径
  或
~/.mcporter/mcporter.json[c] + <cwd>/config/mcporter.json
```

`inspect_mcporter_config()` 只返回 server name、配置来源和 `imports_unchecked`。它刻意不展开 editor imports，避免扩大凭据读取边界。

**任务执行阶段：**

Skill/reference 直接给宿主 Agent `mcporter call ...` 命令；Agent Reach Python 包不参与这一调用。

### 5.3 它连接的不同类型 Server

| Server | 配置/调用形式 | 场景 |
|---|---|---|
| Exa | remote HTTP `https://mcp.exa.ai/mcp` | 网页/技术搜索 |
| xiaohongshu | local HTTP `http://localhost:18060/mcp` | 服务器场景的小红书读取 |
| LinkedIn | `uvx mcp-server-linkedin@latest` stdio | 个人、公司和职位搜索 |
| web-reader | reference 中的 `web-reader.webReader` | 可控格式的网页读取 |

**未验证边界：** 当前快照的默认 `config/mcporter.json` 只列出 Exa 和 xiaohongshu。web-reader 命令存在于 Skill reference，但不代表本机或默认安装流程已配置该 Server。

## 6. MCP 外部 Server 如何被调用

### 6.1 Exa 调用链

```text
用户：“搜索 X”
  → 宿主 Agent 命中 Agent Reach Skill
  → search.md
  → 可选：agent-reach doctor --json
  → ExaSearchChannel.check()
      → 检查 mcporter 命令是否存在
      → inspect_mcporter_config()
      → 只确认 exa server name 已配置，不做远程连通验证
  → 宿主 Shell 执行：
     mcporter call exa.web_search_exa query="..." numResults=5
  → mcporter 解析 server=exa, tool=web_search_exa
  → mcporter 连接 Exa MCP Server
  → MCP tool result 由 mcporter 输出到 stdout
  → 宿主 Agent 解析结果
```

`ExaSearchChannel.check()` 在只看到配置时返回 `warn`，而不是 `ok`，因为“配置存在”不能证明远程 Server 真正可达。

### 6.2 xiaohongshu-mcp 调用链

```text
用户明确授权 Cookie-Editor 导出
  → agent-reach configure xhs-cookies
  → xiaohongshu-mcp 服务运行在 localhost:18060
  → mcporter 配置 server name=xiaohongshu
  → doctor 检查：
      服务端口可达 + mcporter 配置存在
      但不替用户证明登录态
  → 宿主 Agent 先执行：
     mcporter call xiaohongshu.check_login_status --timeout 120000
  → 再执行 search_feeds / get_feed_detail
```

这条链有两次状态检查：Agent Reach doctor 证明本地服务和配置证据，外部 MCP Tool `check_login_status` 才检查平台会话。

### 6.3 MCP 调用中 Agent Reach 不处理的环节

Agent Reach 当前不统一处理：

- MCP initialize/handshake；
- `tools/list` 的运行时 schema；
- tool arguments 的 JSON Schema 校验；
- HTTP/stdio 传输重连；
- CallToolResult 的统一类型转换；
- 外部 MCP 错误的 Observation 记录。

这些由 mcporter、外部 MCP Server 和宿主 Agent 共同承担。

### 6.4 不要与 Agent Reach 自身的 MCP Server 混淆

```text
外部内容 MCP 链：
宿主 Agent → mcporter → Exa/xiaohongshu/LinkedIn/... Server

Agent Reach 状态 MCP 链：
宿主 MCP Client → agent_reach.integrations.mcp_server → get_status
```

后者只返回 doctor 状态，不代理前者的内容 Tool。

## 7. 与 OpenHands Tool System 对比

对比来源：当前 Agent Reach Python/Skill 快照，以及 OpenHands Software Agent SDK 中的 `ToolDefinition`、`ToolExecutor`、`ActionEvent`、`ObservationEvent` 和 `MCPToolExecutor`。更完整的 OpenHands 结论见 [`06-tool-system.md`](../../openhands-study/notes/06-tool-system.md)。

### 7.1 Tool 抽象

| 维度 | Agent Reach | OpenHands |
|---|---|---|
| 核心抽象 | Skill 文本 + Channel 健康描述 | `ToolDefinition` + `ToolExecutor` |
| 输入定义 | reference 中的 CLI 语法 | `Action` Pydantic/JSON schema |
| 输出定义 | 上游命令自定义 | `Observation` 模型 |
| 发现 | Skill 触发描述 + doctor 状态 | Registry/runtime tools 转 LLM tool schema |
| 可执行对象 | 多数不在 Agent Reach 包内 | `ToolDefinition.executor` |
| Conversation 关联 | 无统一对话对象 | Tool 可从 Conversation State 创建 |

Agent Reach Channel 不能等同于 OpenHands Tool：`Channel.check()` 回答“能力是否可用”，`ToolExecutor` 回答“如何执行这次 Action”。

### 7.2 执行流程

**Agent Reach：**

```text
用户请求
  → 宿主 Agent 解释 Skill
  → Shell command / mcporter call
  → 上游工具
  → stdout/stderr
  → 宿主 Agent 自行解释
```

**OpenHands：**

```text
LLM tool call
  → ActionEvent
  → ToolDefinition.action_from_arguments()
  → ToolExecutor
  → Observation
  → ObservationEvent
  → role="tool" message
  → 下一轮 LLM
```

OpenHands 把调用和结果放在显式事件链中；Agent Reach 依赖宿主 Agent 自己的 Shell/MCP Tool 链。

### 7.3 状态管理

| 状态 | Agent Reach | OpenHands |
|---|---|---|
| 配置 | `~/.agent-reach/config.yaml` + 环境变量 | Conversation State、Agent config、Runtime config |
| 能力状态 | Channel `status/active_backend` 快照 | 当前 `ToolDefinition` 表和 runtime tools |
| 调用历史 | 无统一存储 | EventLog 中的 ActionEvent/ObservationEvent |
| Workspace | 不是 Agent Reach 状态 | Conversation State 关联 Workspace |
| 工具结果进下一轮 | 由宿主 Agent 实现 | ObservationEvent 正式转成 LLM message |

### 7.4 错误处理

**Agent Reach 状态层：**

- `probe_command()` 区分 missing/broken/timeout/error/ok；
- `doctor.check_all()` 隔离单个 channel 异常；
- 错误和正常消息都做 URL 凭据脱敏；
- Skill reference 以文本形式提供重试/降级链；
- 外部命令失败后是否重试，主要由宿主 Agent 判断。

**Agent Reach 自身的 MCP Server：**

- `call_tool()` 捕获异常并返回脱敏后的 `TextContent("Error: ...")`；
- 当前代码没有显式生成 `isError=true` 的结构化错误结果。

**OpenHands：**

- 输入先经 Action schema 校验；
- Tool 错误转换为 Observation，并记录到事件链；
- `MCPToolExecutor` 处理未连接、重连失败、异常和超时，返回 `MCPToolObservation(is_error=True)`；
- Observation 输出可做 secret masking；
- 错误 Observation 依然回流下一轮 LLM，Agent 可根据事件历史改策略。

### 7.5 组合时的真实边界

如果 OpenHands 使用 Agent Reach，最可能的链路是：

```text
OpenHands LLM
  → OpenHands ActionEvent
  → OpenHands TerminalTool 或 MCPTool
  → Agent Reach Skill 选定的外部命令/Server
  → 外部结果
  → OpenHands TerminalObservation 或 MCPToolObservation
  → OpenHands ObservationEvent
```

Agent Reach 不会替代 OpenHands Tool System；它提供“怎样选外部能力”的知识和状态证据，OpenHands 继续负责执行、风险、事件和反馈循环。

## 8. 端到端流程示例

### 8.1 GitHub：直接 CLI 路径

```text
用户要求搜索 GitHub 仓库
  → Skill 路由到 dev.md
  → doctor 查 GitHubChannel
      → probe gh --version
      → 只读查认证配置证据
      → 不执行可能写 device-id 的 gh auth status
  → 宿主 Agent 执行 gh search repos ...
  → gh 请求 GitHub
  → stdout/exit code 返回宿主 Agent
```

### 8.2 Exa：MCP 桥接路径

```text
用户要求全网搜索
  → Skill 路由到 search.md
  → doctor 查 ExaSearchChannel
  → 宿主 Agent 执行 mcporter call exa.web_search_exa ...
  → mcporter → Exa MCP Server → Search backend
  → MCP result → mcporter stdout
  → 宿主 Agent 合并结果
```

### 8.3 小红书：多 backend + 二次验证

```text
用户请求小红书搜索
  → Skill 路由到 social.md
  → doctor 运行 XiaoHongShuChannel.check()
  → 按 OpenCLI → xiaohongshu-mcp → xhs-cli 检查
  → 如 active_backend=OpenCLI：执行 opencli xiaohongshu ...
  → 如 MCP 服务有证据但登录未证明：
      mcporter call xiaohongshu.check_login_status
      → 成功后才调 search_feeds
  → 如只有存量 xhs-cli：按 reference 执行存量命令
```

## 9. 事实、推测、建议与未验证项

### 已确认事实

- Skill 由中英文主文件和 7 份领域 reference 组成；
- Skill 是 Markdown 指令，不是 Tool Registry；
- `ALL_CHANNELS` 保存 16 个进程内 channel 实例；
- `active_backend` 是检查快照，不是持久会话状态；
- backend 覆盖只调整已知候选顺序，不会隐藏其他候选；
- 多 backend channel 通常先选 `ok`，再选 `warn`；
- 多数内容调用由宿主 Agent 直接执行上游命令；
- mcporter 是外部 MCP Client/CLI 桥接，Agent Reach 主要管理配置和用法；
- Agent Reach 自身 MCP Server 只有 `get_status`；
- OpenHands Tool System 有强类型 Action/Observation 和正式事件回流，Agent Reach 没有对等抽象。

### 合理推测

- Agent Reach 通过减少统一 wrapper 降低了跟随平台变化的转换成本，但增加了宿主 Agent 对文本指令的依赖；
- 在多 Agent 平台共用时，MCP Tool 的 schema 与结构化错误比纯 CLI reference 更易治理，但会增加 Server 运维和协议边界；
- 共享 channel 实例对当前顺序 CLI 足够，但长运行并发服务可能需要将检查结果改为不可变快照。

### 主观建议

- 将 doctor 结果当作“能力证据”而不是真实内容调用结果；
- 对 `warn` 或 `active_backend=null` 的渠道，必须用 reference 中的只读命令二次验收；
- 宿主 Agent 应建立独立权限层，不能因为 Skill reference 列出命令就自动获得写入权限；
- 未来与 OpenHands 集成时，优先将外部调用保留在 OpenHands Tool/Observation 闭环中，而不是绕过事件系统。

### 未验证信息

- 本机 Skill 客户端对这份 frontmatter 的真实触发行为；
- 本机 16 个 channel 的实际状态；
- mcporter 内部的 MCP handshake、schema 校验和重连细节；
- Exa、xiaohongshu、LinkedIn 和 web-reader MCP Server 的实际可达性；
- 任何登录态、Cookie 或平台内容请求；
- Agent Reach Skill 在 OpenHands 内的自动发现和安装兼容性；
- 长运行/并发调用 `check_all()` 时的 channel 状态隔离。

## 10. 关键源码索引

| 主题 | 文件 | 关键内容 |
|---|---|---|
| Skill 主入口 | [`skill/SKILL.md`](../agent-reach/agent_reach/skill/SKILL.md) | frontmatter、常驻规则、路由表、快速命令 |
| Skill 安装 | [`cli.py`](../agent-reach/agent_reach/cli.py) | `_install_skill()`, `_cmd_skill()` |
| Channel 抽象 | [`channels/base.py`](../agent-reach/agent_reach/channels/base.py) | `Channel`, `ordered_backends()` |
| Channel 注册 | [`channels/__init__.py`](../agent-reach/agent_reach/channels/__init__.py) | `ALL_CHANNELS`, `get_all_channels()` |
| 状态聚合 | [`doctor.py`](../agent-reach/agent_reach/doctor.py) | `check_all()`, `format_report()` |
| 命令探测 | [`probe.py`](../agent-reach/agent_reach/probe.py) | `ProbeResult`, `probe_command()` |
| OpenCLI 状态 | [`backends/opencli.py`](../agent-reach/agent_reach/backends/opencli.py) | `OpenCLIStatus`, `opencli_status()` |
| mcporter 配置 | [`channels/mcporter.py`](../agent-reach/agent_reach/channels/mcporter.py) | `inspect_mcporter_config()`, `configured_server_names()` |
| Exa channel | [`channels/exa_search.py`](../agent-reach/agent_reach/channels/exa_search.py) | `ExaSearchChannel.check()` |
| 小红书 channel | [`channels/xiaohongshu.py`](../agent-reach/agent_reach/channels/xiaohongshu.py) | `XiaoHongShuChannel.check()` |
| Agent Reach MCP | [`integrations/mcp_server.py`](../agent-reach/agent_reach/integrations/mcp_server.py) | `create_server()`, `get_status` |
| 搜索 reference | [`references/search.md`](../agent-reach/agent_reach/skill/references/search.md) | Exa MCP 命令 |
| 社交 reference | [`references/social.md`](../agent-reach/agent_reach/skill/references/social.md) | 多 backend 命令、验收和降级链 |
| GitHub reference | [`references/dev.md`](../agent-reach/agent_reach/skill/references/dev.md) | `gh` 读/写命令 |
| OpenHands Tool | [`tool.py`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/tool/tool.py) | `ToolDefinition`, `ToolExecutor` |
| OpenHands Action | [`action.py`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/event/llm_convertible/action.py) | `ActionEvent` |
| OpenHands Observation | [`observation.py`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/event/llm_convertible/observation.py) | `ObservationEvent` |
| OpenHands MCP executor | [`mcp/tool.py`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/mcp/tool.py) | `MCPToolExecutor` |
