# Agent Reach 安全模型与权限边界

> - 研究日期：2026-10-14
> - Agent Reach submodule：`94f06c1969dfc1834001269d79d3ad0972d9dee6`
> - 源码声明版本：`1.5.0`
> - 分析方式：人工源码阅读
> - 未安装依赖、未执行外部平台操作、未修改官方源码

## 0. 结论先行与前提修正

Agent Reach 目前不是权限沙箱，也不是统一的 Tool 执行器。它的安全模型由四层松散组合而成：

```text
Skill 文本规则
  → 宿主 Agent 的授权判断与 Shell 权限
  → Agent Reach 的安装、配置、doctor 和少量包装代码
  → gh / OpenCLI / mcporter / 平台 CLI / MCP Server 等上游工具
```

其中只有部分本地文件、URL 和子进程边界由 Agent Reach Python 代码强制执行。是否允许 GitHub 写入、是否读取登录态、是否把数据发给外部服务，很多时候仍取决于宿主 Agent 是否遵守 Skill 文本和用户授权。

因此需要修正三个容易混淆的前提：

1. **Skill 中写着“只读”不等于程序只能只读。** reference 中已经存在 GitHub 写操作命令。
2. **doctor 显示 backend 可用不等于该 backend 被隔离或已获得授权。** doctor 主要检查环境证据。
3. **OpenHands 的确认策略不等于 Runtime Sandbox。** 前者控制 Action 是否暂停等待用户，后者控制代码在哪个工作区/容器内执行；两者是互补而非替代关系。

## 1. Skill 中声明的能力范围

### 1.1 frontmatter 的公开边界

[`agent_reach/skill/SKILL.md`](../agent-reach/agent_reach/skill/SKILL.md) 把自身定位为 16 个互联网渠道的“内容获取与路由”Skill：

- 适用于搜索、读取 URL、查看社交讨论、GitHub 代码搜索、视频字幕、职位和财经信息；
- 不负责报告写作、分析、翻译等内容加工；
- 明确排除发帖、评论、点赞等写操作；
- 已有专门 Skill 时优先使用专门 Skill。

### 1.2 常驻安全规则

Skill 正文还声明了以下约束：

- 多 backend 或登录态渠道先执行 `agent-reach doctor --json`；
- doctor 为避免浏览器 Cookie 读取或远端写入，可以只返回 `warn` 和 `active_backend: null`；
- 只有用户任务确实需要该平台时，才运行 reference 中的只读验收命令；
- 小红书不自动登录，OpenCLI 只复用用户明确控制的已有 Chrome 会话；
- Twitter 使用 Cookie-Editor 显式提供的 `auth_token` 和 `ct0`，不得在日志或命令回显中暴露；
- Boss 直聘安装前要求明确授权，启动专用 Chrome 后暂停，等待用户肉眼确认登录状态；
- 遇到 Boss `ACCOUNT_RISK` / `ENVIRONMENT_RISK` 等风险信号时停止，而不是自动重试；
- 临时输出放到 `/tmp/`，持久数据放到 `~/.agent-reach/`，不在 Agent 工作区创建文件。

这些规则体现了“显式授权、少读 Cookie、先检查再调用”的设计意图。

### 1.3 强制力边界

上述规则大多是给宿主 Agent 的自然语言指令，不是操作系统权限或代码级 capability：

| 规则 | 是否由 Agent Reach 强制 |
|---|---|
| doctor 不运行可能触发 Cookie 回退的 Twitter/XHS status | 是，相关 `check()` 代码不启动上游 CLI |
| 浏览器提取必须指定一个平台 | 是，`extract_all()` 缺少 `platform` 时拒绝 |
| Twitter/XHS 禁止自动浏览器提取 | 是，要求手工 Cookie-Editor 路径 |
| 禁止 GitHub 写操作 | 否，reference 中存在写命令 |
| 外部工具只能读取 | 否，上游二进制拥有自己的完整能力 |
| 安装前必须征得用户确认 | 主要靠 Skill 和宿主 Agent；`--system` 是显式开关，但不是交互式审批系统 |
| 不在工作区创建文件 | 主要靠宿主 Agent；`gh repo clone` 示例若在当前目录运行会创建文件 |

## 2. 实际可执行命令范围

### 2.1 实际上限由宿主 Shell 决定

Agent Reach 安装后，多数任务不是进入一个受控执行器，而是由宿主 Agent 直接运行上游命令：

```text
宿主 Agent
  → Shell/exec
      → gh / curl / yt-dlp / OpenCLI / twitter / bili / rdt
      → mcporter → 外部 MCP Server
      → pipx / uv / npm / apt-get / brew / docker（安装或配置时）
```

所以真实权限上限是：**宿主进程权限 + Shell 可执行权限 + 上游工具登录态 + 网络可达范围**，而不是 `SKILL.md` 的路由表。

### 2.2 命令能力分类

| 类别 | 源码/reference 中的例子 | 可产生的影响 |
|---|---|---|
| 公开读取 | `curl`、Exa 搜索、V2EX API、`bili search` | 对外发出查询，结果进入 Agent 上下文 |
| 登录态读取 | Twitter feed、Reddit、Facebook feed、Instagram saved、Boss 搜索 | 可读取账号可见内容，触发平台风控或速率限制 |
| 本地文件写入 | 配置 YAML、Cookie 文件、字幕、转录文件、git clone | 写入用户目录、临时目录或当前目录 |
| 系统/工具安装 | `apt-get install`、`brew install`、`npm install -g`、`pipx install`、`uv tool install` | 修改系统或用户级工具链并执行第三方安装代码 |
| 容器变更 | `docker cp`、`docker restart`、启动 xiaohongshu-mcp | 向容器写入 Cookie、改变服务状态 |
| 外部账号写入 | `gh repo create/fork/sync`、`gh issue create`、`gh pr create`、`gh release create` | 修改 GitHub 远端状态 |
| 通用扩展入口 | `gh api`、`mcporter call`、OpenCLI 和上游 CLI | 能力由具体参数、Tool schema 和账号权限决定 |

### 2.3 已确认的不一致

[`references/dev.md`](../agent-reach/agent_reach/skill/references/dev.md) 同时列出了：

- `gh repo create`；
- `gh repo fork` / `gh repo sync`；
- `gh issue create`；
- `gh pr create`；
- `gh release create`；
- 通用 `gh api`。

这与 Skill frontmatter 的“不是写操作 Skill”存在实际不一致。它不会自动触发这些命令，但宿主 Agent 若照 reference 执行，就会越过声明的只读边界。

另一个较弱的不一致是“不要在工作区创建文件”与无目标目录的 `gh repo clone owner/repo` 示例：命令本身会在当前工作目录创建仓库。是否违反规则取决于宿主 Agent 选择的 cwd，Agent Reach 没有代码检查。

## 3. GitHub、社交平台和外部服务风险

### 3.1 GitHub

#### 源码确认事实

- [`GitHubChannel.check()`](../agent-reach/agent_reach/channels/github.py) 只运行带遥测关闭环境变量的 `gh --version`，不运行可能写入 device-id 的 `gh auth status`；
- 它只确认环境变量、Agent Reach 配置或 `gh hosts.yml` 中存在认证线索，不验证 token scope、账号身份和实时有效性；
- `github_token` 可以保存到 Agent Reach 配置，但 `gh` 命令并不会自动读取 `~/.agent-reach/config.yaml`；实际调用仍依赖 `GH_TOKEN`、`GITHUB_TOKEN` 或 `gh auth login` 等上游认证方式；
- reference 包含远端写命令，但没有 Action 级审批层。

#### 推测风险

- 高权限 GitHub token 会把“源码检索”扩大为仓库、Issue、PR、Release 甚至 API 写入能力；
- `gh api` 是通用入口，未来增加参数后可以突破 reference 当前示例范围；
- 认证存在性与实时身份不一致时，宿主 Agent 可能对错误账号或组织执行操作；
- clone、fork、sync 等命令可能同时影响本地磁盘和远端仓库。

### 3.2 社交平台与招聘平台

#### 源码确认事实

- OpenCLI 复用用户已有 Chrome 会话；Twitter、Reddit、Facebook、Instagram、Boss 等能力可继承账号当前可见范围；
- Twitter doctor 不运行会触发自动浏览器 Cookie 回退的 `twitter status`；
- XHS doctor 不运行可能自动读取/刷新 Cookie 的上游 status；
- Boss 使用专用 Chrome/CDP，并要求用户手动登录和确认；风险错误要求停止；
- reference 主要提供读取命令，并对小红书写操作给出“不建议”的文字提示。

#### 推测风险

- 浏览器会话通常不只代表“读公开内容”，还可能看到私有 feed、收藏、群组或账号关联信息；
- 上游 CLI 或浏览器扩展若被替换、升级或恶意化，可以利用已有登录态执行超出 reference 的操作；
- 自动化访问可能触发限流、验证码、账号风控或封禁，尤其是 Twitter、Boss 等有明确提示的平台；
- 平台内容、用户名和搜索词会进入终端输出、Agent 上下文、Conversation/EventLog 或其他日志系统，Agent Reach 本身不统一控制这些下游存储。

### 3.3 外部内容和 AI 服务

#### 源码确认事实

- Jina Reader 路径会把目标 URL 发送给 `r.jina.ai`；
- Exa MCP 会收到搜索 query；
- Groq/OpenAI Whisper 路径会上传音频分片和 API key；只有显式启用 provider fallback 时才允许换到第二个转录服务；
- Python [`WebChannel.read()`](../agent-reach/agent_reach/channels/web.py) 会拒绝非 HTTP(S)、带 userinfo、localhost、内网和非全局 IP，并限制响应为 5 MiB；
- Skill 的常用网页路径是宿主直接执行 `curl https://r.jina.ai/URL`，不会经过 `WebChannel.read()` 的 URL 校验。

#### 推测风险

- 带签名参数、一次性 token 或私密路径的公开 URL 会泄露给 Reader/MCP 提供商；
- 音频和搜索内容可能包含个人、商业或未公开信息，上传行为需要独立的数据授权；
- 外部网页、社交内容和 MCP 返回值都属于不可信输入，可能包含 prompt injection；Agent Reach 没有统一的内容净化或 provenance 策略；
- `npm install -g mcporter`、未固定版本的 PyPI/npm 工具、`uvx ...@latest` 和未固定镜像标签扩大了供应链风险。rdt-cli 与 Boss CLI 在当前源码中固定了 commit，但 mcporter、OpenCLI、twitter-cli、bilibili-cli 等并非全部固定版本。

## 4. Token、Cookie 和认证信息处理

### 4.1 输入方式

[`_read_configure_value()`](../agent-reach/agent_reach/cli.py) 的默认交互方式是 `getpass` 隐藏输入，也支持 stdin。若把敏感值作为位置参数传入，CLI 会警告它可能出现在 shell history 和进程列表中，但仍接受该值。

这意味着：安全默认值较好，但不是强制禁止不安全输入。

### 4.2 Agent Reach 配置文件

[`Config`](../agent-reach/agent_reach/config.py) 将 token、Cookie、API key 和代理写入：

```text
~/.agent-reach/config.yaml
```

已确认的保护包括：

- YAML 使用 `safe_load` / `safe_dump`；
- 读取和写入拒绝路径中的符号链接；
- 限制配置文件读取大小为 1 MiB；
- 同目录临时文件 + `os.replace()` 原子替换；
- POSIX 下目录设为 `0700`、文件设为 `0600`；
- `Config(read_only=True)` 可阻止 doctor/MCP 状态路径保存配置；
- `to_dict()` 按 key 名中的 `key/token/password/proxy/cookie/secret/session/auth/ct0` 等标记脱敏。

边界与风险：

- 数据是**明文 YAML**，没有应用层加密；
- Windows 分支没有显式设置 NTFS ACL，源码不能证明只有当前用户可读；
- `Config.get()` 先读配置文件、再读环境变量，已有文件值会覆盖同名环境变量；
- `to_dict()` 是按字段名启发式遮罩，不是 secret 类型系统；
- [`scrub_url_credentials()`](../agent-reach/agent_reach/utils/text.py) 只覆盖 URL userinfo 和一组敏感 query/fragment 参数，不能清除任意正文中的裸 token、Cookie header 或第三方工具输出。

### 4.3 浏览器 Cookie 的最小读取

[`cookie_extract.py`](../agent-reach/agent_reach/cookie_extract.py) 的代码级约束包括：

- 必须明确指定一个 platform，不再支持全平台批量读取；
- 只请求该平台允许的域名和 Cookie 名；
- 对浏览器库返回值再次做真实域名匹配，防止 lookalike domain 混入；
- 显式 profile 不存在时失败，不回退到 Default；
- Twitter 与 XHS 禁止自动浏览器提取，要求 Cookie-Editor 手工导出；
- Bilibili 只保留 `SESSDATA` / `bili_jct`，雪球只保留 `xq_a_token`。

这里的“最小读取”只约束 Agent Reach 自己的提取函数。OpenCLI、twitter-cli、xhs-cli 和其他上游程序如何读取浏览器数据，仍取决于上游实现。

### 4.4 凭据副本与生命周期

- Twitter token 默认存入 Agent Reach YAML；只有显式 `--sync-legacy-twitter` 才额外写入 xfetch 和 bird 文件；
- legacy 文件用私有原子写入，bird 值经过 `shlex.quote()`；
- 卸载时不会自动删除无法证明所有权的 legacy Twitter 副本，而是列出路径让用户人工判断；
- XHS Cookie 在没有 Docker 时保存到 `~/.agent-reach/xhs-cookies.json`；有 Docker 时先写临时文件，再 `docker cp` 到容器并重启；临时删除失败会报警，但副本可能残留；
- XHS Cookie-Editor JSON 会过滤非 `xiaohongshu.com` 域；Header String 模式则把用户提供的各键构造成该域 Cookie，因此输入范围由用户负责；
- doctor 对 Twitter/XHS/Reddit 等登录态主要读取本地证据，不执行可能刷新、保存或自动抓取浏览器 Cookie 的上游命令。

### 4.5 凭据责任边界

Agent Reach 没有统一 secret broker。凭据可能分散在：

- `~/.agent-reach/config.yaml`；
- `gh hosts.yml`；
- 浏览器 profile；
- `~/.config/xfetch/session.json` / bird env 文件；
- rdt/xhs/Boss 自己的 credential/session 文件；
- Docker 容器文件系统；
- mcporter/MCP Server 自己的配置或环境变量。

因此“删除 Agent Reach 配置”不等于撤销平台 session、删除所有副本或吊销 token；真正撤销通常还需要平台端退出、token revoke 和上游工具清理。

## 5. 与 OpenHands Runtime Sandbox 对比

### 5.1 权限隔离

| 维度 | Agent Reach | OpenHands 当前源码 |
|---|---|---|
| 默认执行位置 | 宿主 Agent 的 Shell/浏览器/用户目录 | 可在本地 Workspace，也可为每个 Conversation 启动 Docker Runtime |
| 文件边界 | 没有统一工作区强制边界；上游命令按宿主权限访问 | Docker Conversation Runtime 只 bind mount conversation、persistence、workspace 三个目录 |
| 进程权限 | 继承宿主用户和可执行工具权限 | 当前 Canvas Docker Runtime 使用宿主 uid/gid、`--cap-drop ALL`、`no-new-privileges` |
| 网络 | 由宿主网络和上游工具决定 | Docker Runtime 默认仍可联网；源码没有默认 `--network none`，并映射 `host.docker.internal` |
| API 暴露 | 无统一执行 API | Runtime API 端口绑定 `127.0.0.1`，使用每个 Conversation 的 session API key |
| 资源限制 | 少量调用级 timeout/大小限制，没有全局 CPU/内存/进程隔离 | 内存、CPU、PID 限制可配置，但是否启用取决于部署配置 |
| 更强隔离 | 无内置容器沙箱层 | Kubernetes AgentSandbox 可配置 gVisor/Kata 与 NetworkPolicy，但不是自动保证 |

OpenHands 仓库 README 也明确说明：Docker setting 隔离的是每个 Conversation 的执行，不会把整个 Canvas 或 automation service 都移入沙箱。同一个宿主工作区若被多个 Conversation 挂载，它们仍会共享和竞争这些文件。

### 5.2 执行边界

Agent Reach 主路径：

```text
Skill 文本 → 宿主 Shell → 上游 CLI/MCP → 宿主文件系统与网络
```

OpenHands Agent Loop 主路径：

```text
LLM Tool Call
  → ActionEvent
  → SecurityAnalyzer / ConfirmationPolicy
  → ToolExecutor
  → Workspace/Runtime
  → ObservationEvent
```

OpenHands 的强项是将 Agent 选择、风险分析、等待确认、执行结果和拒绝结果放入 EventLog。但也有一个明确旁路：[`LocalConversation.execute_tool()`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py) 的文档直接声明，它绕过 Agent Loop、ConfirmationPolicy 和 SecurityAnalyzer，调用者必须自行实施保护。

这说明即使 OpenHands 有安全层，也不能把所有工具入口自动视为已受保护。

### 5.3 用户确认机制

#### Agent Reach

Agent Reach 没有统一的 `ActionEvent → WAITING_FOR_CONFIRMATION → accept/reject` 状态机。现有确认点主要是：

- Skill 要求宿主 Agent 在安装、登录和 Cookie 导入前征得授权；
- `install` 默认是 safe mode，只有显式 `--system` 才执行系统变更；
- Cookie 配置通常需要隐藏输入或 stdin；
- Boss 流程要求暂停并让用户肉眼确认登录；
- 风险错误的 runbook 要求停止。

这些都是有价值的控制，但其执行依赖调用方。

#### OpenHands

OpenHands SDK 提供：

- `AlwaysConfirm`：全部 Action 确认；
- `NeverConfirm`：不确认；
- `ConfirmRisky`：达到风险阈值或风险未知时确认；
- `SecurityAnalyzerBase`：为 Action 产生 `LOW/MEDIUM/HIGH/UNKNOWN`；分析器异常默认降级为 `HIGH`；
- `SecurityAnalysisEvent`：记录分析器、策略和每个 Action 的风险；
- `WAITING_FOR_CONFIRMATION`：暂停工具执行；
- `UserRejectObservation`：把拒绝作为 Tool 结果回到事件历史和下一轮 LLM 上下文。

需要注意：

- SDK 的 `ConversationConfig` 和 `ConversationState` 默认是 `NeverConfirm`，且 analyzer 默认为 `None`；
- Canvas 只有在 `confirmation_mode=true` 时才配置确认：LLM analyzer 对应 `ConfirmRisky(HIGH, confirm_unknown=true)`，其他 analyzer 对应 `AlwaysConfirm`；关闭确认模式时是 `NeverConfirm`；
- 因此“OpenHands 支持确认”是已确认事实，“每次危险操作默认都会询问”不是事实。

## 6. MCP 外部 Server 的信任问题

### 6.1 Agent Reach 实际验证到哪里

[`inspect_mcporter_config()`](../agent-reach/agent_reach/channels/mcporter.py) 只安全读取配置并提取 server name：

- 拒绝符号链接和超大配置；
- 要求 JSON 顶层和 `mcpServers` 结构正确；
- 不读取 editor imports，以免扩大 doctor 的凭据读取边界；
- 不验证 MCP Server 身份、证书归属、Tool schema、Tool 实现或结果内容。

Exa doctor 看到配置时返回 `warn`，XHS doctor 只额外检查 localhost 服务有响应；这都不是 Server 可信证明。

### 6.2 信任链

```text
Skill/reference
  → 宿主 Agent 选择 server.tool
  → mcporter 读取配置和 imports
  → remote HTTP / local HTTP / stdio MCP Server
  → Server 执行网络、浏览器或本地逻辑
  → 不可信 Tool Result
  → 宿主 Agent 上下文
```

每一层都有独立信任问题：

| 边界 | 风险 |
|---|---|
| MCP 配置 | server name 可被同名项目配置覆盖；doctor 不展开的 imports 可能在真实 mcporter 运行时生效 |
| remote HTTP Server | 查询、URL 和参数会离开本机；需要信任运营方、TLS 和数据保留策略 |
| local HTTP Server | “localhost”不代表可信；本地其他进程可能占用端口，当前 XHS 探针把任何 HTTP 响应都视为服务存活 |
| stdio Server | 启动命令以当前用户权限执行包或二进制，等同于本地代码执行边界 |
| Tool schema | Agent Reach 不做 `tools/list` schema 审核或 allow-list 参数校验 |
| Tool result | 可能包含恶意指令、伪造来源、超长内容或敏感数据；没有统一 prompt-injection 处理 |
| 凭据 | Server 或其依赖可能接触浏览器 session、Cookie、API key 和查询内容 |

### 6.3 当前配置中的具体案例

#### Exa

- 默认配置指向 `https://mcp.exa.ai/mcp`；
- 远端 Server 会看到搜索 query；
- Agent Reach 只确认 `exa` 名称存在，不做实时远端验证。

#### xiaohongshu-mcp

- 默认地址是 `http://localhost:18060/mcp`；
- Cookie 被复制到该服务容器或本地文件；
- 文档示例使用未固定 digest/tag 的 `xpzouying/xiaohongshu-mcp` 镜像；
- doctor 只验证端口响应和配置存在，登录态要另调 `check_login_status`。

#### LinkedIn

- reference 使用 `uvx mcp-server-linkedin@latest --login`；
- `@latest` 会把本地代码执行和登录态交给当时解析到的发布版本；
- Agent Reach submodule 不包含该 Server 源码，本阶段不能验证其凭据保存、网络调用和 Tool 实现。

#### web-reader

- Skill reference 提供 `web-reader.webReader` 调用；
- 当前默认 `config/mcporter.json` 没有该 Server；
- 不能据此认定本机已配置、Server 来源可信或工具可用。

### 6.4 Agent Reach 自身的 MCP Server

[`integrations/mcp_server.py`](../agent-reach/agent_reach/integrations/mcp_server.py) 只暴露 `get_status`，并用 `Config(read_only=True)` 生成 doctor 报告。它不代理 Exa、XHS 或 LinkedIn 内容 Tool。

它的异常会被转成普通 `TextContent("Error: ...")`，而不是结构化错误状态；错误文本仅经过 URL 凭据脱敏。这可能影响调用方准确区分“成功返回错误文字”和协议级失败，但不扩大它自身的只读工具范围。

## 7. 风险分层与建议

### 7.1 源码确认事实

- Skill 宣称内容获取为主并排除写操作，但 GitHub reference 包含多种写命令；
- Agent Reach 没有统一 Tool Executor、Action 审批或 Runtime Sandbox；
- 安装默认 safe，显式 `--system` 才运行系统安装和配置；
- 配置、Cookie 提取、URL 读取和 doctor 路径存在符号链接、大小、域名、脱敏与副作用控制；
- 配置密钥以明文存储，POSIX 权限收紧，Windows ACL 未由源码显式设置；
- 多数真实平台调用绕过 Agent Reach Python 包，由宿主直接执行上游工具；
- OpenHands 提供容器边界和 Action 确认机制，但 SDK 默认 `NeverConfirm`，且 `execute_tool()` 可绕过确认链；
- Agent Reach 对 mcporter 配置的验证止于本地结构与 server name。

### 7.2 推测风险

- 恶意或被攻陷的上游 CLI、npm/PyPI 包、MCP Server 或浏览器扩展可能利用宿主权限和登录态；
- 外部结果可能对 LLM 实施 prompt injection，诱导后续写文件、泄露数据或执行命令；
- 共享浏览器 profile、过宽 GitHub token 和未隔离 Shell 会把一个“读取任务”扩大为账号级或主机级影响；
- Windows 上配置文件是否仅当前用户可读取决于目录继承 ACL，不能从当前 Python 分支确认；
- Localhost MCP 端口若被其他进程抢占，doctor 的“服务可达”可能造成错误信任；
- Docker Sandbox 若允许默认网络、挂载敏感目录或转发 secrets，仍可能发生数据外传；容器不是绝对安全边界。

### 7.3 主观建议

1. 把 Agent Reach 按“非特权路由文档 + 本地配置工具”部署，不把它视为 sandbox。
2. 宿主 Agent 对 reference 建立独立 allow-list：默认只允许读取命令；`create/fork/sync/issue/pr/release` 必须再次确认。
3. GitHub 使用最小 scope、短期 token 或独立研究账号；不要把管理员级 token 放入 Agent Reach YAML。
4. 在 Windows 上人工检查 `~/.agent-reach`、mcporter 和上游 credential 目录 ACL。
5. 对带敏感 query 的 URL 不使用第三方 Reader；音频上传前单独确认数据边界。
6. MCP Server 固定版本、commit 或镜像 digest；审核启动命令、环境变量和可访问目录。
7. 将 MCP 返回内容标记为外部不可信数据，不能让返回文本直接取得命令执行权。
8. 若将 Agent Reach 接入 OpenHands，优先通过受控 ToolDefinition/Action/Observation 包装，并启用适当 ConfirmationPolicy；不要用 `execute_tool()` 绕过策略。
9. OpenHands Docker Runtime 只挂载任务所需目录，并视需要关闭外网或配置 NetworkPolicy，而不是依赖容器默认值。

### 7.4 未验证内容

- 本机 `~/.agent-reach`、浏览器 profile 和上游 credential 文件的实际 ACL；
- 当前用户是否安装或登录了任何上游 CLI；
- GitHub token、Cookie、API key 的真实 scope、有效期和撤销状态；
- mcporter 的 handshake、TLS、重连、schema 校验、editor import 与日志行为；
- Exa、Jina、Groq、OpenAI 等服务的当前数据保留和隐私政策；
- xiaohongshu-mcp、LinkedIn MCP、web-reader 及 OpenCLI 的当前源码安全性；
- Docker Desktop/Engine、Kubernetes、gVisor/Kata 在本机的实际配置；
- OpenHands Confirmation UI 和 Runtime Sandbox 的动态运行效果；
- 任何外部平台的实时可达性、登录状态、风控或账号行为。

## 8. 关键调用链

### 8.1 登录态平台

```text
用户任务
  → Skill 要求 doctor
  → Channel.check() 读取最小本地证据
  → active_backend / warn
  → 宿主 Agent 决定是否运行只读验收命令
  → 上游 CLI/MCP 取得浏览器 session 或显式 Cookie
  → 平台返回内容
  → 宿主 Agent 验收并处理外部不可信结果
```

### 8.2 OpenHands 中的理想包装

```text
Agent Reach 路由结果
  → OpenHands ToolDefinition
  → ActionEvent
  → SecurityAnalyzer
  → ConfirmationPolicy
  → WAITING_FOR_CONFIRMATION（如需要）
  → ToolExecutor 在受限 Workspace/Runtime 执行
  → ObservationEvent
```

这条组合链能增加事件审计和执行隔离，但仍需要正确选择 Runtime、挂载、网络策略、secret scope 和确认默认值。

## 9. 关键源码索引

| 主题 | 文件 | 类/函数 |
|---|---|---|
| Skill 声明 | [`skill/SKILL.md`](../agent-reach/agent_reach/skill/SKILL.md) | frontmatter、常驻规则、登录态边界 |
| GitHub 命令范围 | [`references/dev.md`](../agent-reach/agent_reach/skill/references/dev.md) | gh 读写命令清单 |
| 社交平台边界 | [`references/social.md`](../agent-reach/agent_reach/skill/references/social.md) | OpenCLI、Twitter、XHS、Reddit 等 |
| 招聘登录态 | [`references/career.md`](../agent-reach/agent_reach/skill/references/career.md) | LinkedIn MCP、Boss CDP |
| 配置存储 | [`config.py`](../agent-reach/agent_reach/config.py) | `Config`, `_atomic_write_yaml()` |
| Cookie 读取 | [`cookie_extract.py`](../agent-reach/agent_reach/cookie_extract.py) | `extract_all()`, `configure_from_browser()` |
| 私有文件 | [`utils/paths.py`](../agent-reach/agent_reach/utils/paths.py) | `atomic_write_private_text()`, `read_small_text_no_follow()` |
| 脱敏 | [`utils/text.py`](../agent-reach/agent_reach/utils/text.py) | `scrub_url_credentials()` |
| URL 校验 | [`utils/url.py`](../agent-reach/agent_reach/utils/url.py) | `normalize_public_http_url()`, `host_matches()` |
| 安装/认证 | [`cli.py`](../agent-reach/agent_reach/cli.py) | `_cmd_install()`, `_cmd_configure()`, `_configure_xhs_cookies()` |
| GitHub doctor | [`channels/github.py`](../agent-reach/agent_reach/channels/github.py) | `GitHubChannel.check()` |
| Twitter doctor | [`channels/twitter.py`](../agent-reach/agent_reach/channels/twitter.py) | `TwitterChannel.check()` |
| XHS doctor | [`channels/xiaohongshu.py`](../agent-reach/agent_reach/channels/xiaohongshu.py) | `XiaoHongShuChannel.check()` |
| mcporter 配置 | [`channels/mcporter.py`](../agent-reach/agent_reach/channels/mcporter.py) | `inspect_mcporter_config()` |
| Agent Reach MCP | [`integrations/mcp_server.py`](../agent-reach/agent_reach/integrations/mcp_server.py) | `create_server()`, `get_status` |
| OpenHands 确认策略 | [`confirmation_policy.py`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/security/confirmation_policy.py) | `AlwaysConfirm`, `NeverConfirm`, `ConfirmRisky` |
| OpenHands 风险分析 | [`analyzer.py`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/security/analyzer.py) | `SecurityAnalyzerBase`, `SecurityAnalysis` |
| OpenHands Action 门控 | [`agent.py`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/agent/agent.py) | `_analyze_for_confirmation()`, `_set_confirmation_status()` |
| OpenHands 确认旁路 | [`local_conversation.py`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py) | `reject_pending_actions()`, `execute_tool()` |
| OpenHands Docker Runtime | [`registry.py`](../../openhands-study/software-agent-sdk/openhands-agent-server/openhands/agent_server/docker_runtime/registry.py) | `DockerConversationRegistry._build_container()` |
| Runtime 凭据 | [`provisioning.py`](../../openhands-study/software-agent-sdk/openhands-agent-server/openhands/agent_server/docker_runtime/provisioning.py) | `RuntimeIdentity`, `RuntimeProvisioningStore` |
| 通用 Docker Workspace | [`docker/workspace.py`](../../openhands-study/software-agent-sdk/openhands-workspace/openhands/workspace/docker/workspace.py) | `DockerWorkspace` |
| Kubernetes Sandbox | [`agent_sandbox/README.md`](../../openhands-study/software-agent-sdk/openhands-workspace/openhands/workspace/agent_sandbox/README.md) | gVisor/Kata、NetworkPolicy、PVC |
| Canvas 策略映射 | [`agent-server-adapter.ts`](../../openhands-study/openhands/src/api/agent-server-adapter.ts) | `getConversationConfirmationPolicy()` |
