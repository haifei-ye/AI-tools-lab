# Agent Reach 第一次安全最小实验方案

> - 设计日期：2026-10-14
> - Agent Reach submodule：`94f06c1969dfc1834001269d79d3ad0972d9dee6`
> - 源码声明版本：`1.5.0`
> - 当前状态：**仅完成方案设计，尚未执行**
> - 本阶段未安装环境、未访问外部平台、未导入 Cookie、未修改官方源码

## 0. 前提修正与实验范围

“验证 Agent Reach 的能力接入方式”容易被误解成“运行 Agent Reach 后，由它统一执行所有外部 Tool”。当前源码并不是这种架构：

```text
Agent Reach Skill 提供触发说明、路由规则和参考命令
  → 宿主 Agent 选择 channel/backend
  → 宿主 Agent 直接调用 curl、gh、mcporter 等上游工具
  → 宿主 Agent 解释结果
```

[`Channel`](../agent-reach/agent_reach/channels/base.py) 主要抽象“某平台能否处理、哪个 backend 可用”，不是统一的 Tool 执行器。源码注释也明确说明，安装完成后由 Agent 直接调用上游工具。只有少数 Channel 另有直接处理方法，例如 [`WebChannel.read()`](../agent-reach/agent_reach/channels/web.py)。

因此，本实验要验证的是：**宿主 Agent 能否正确加载 Agent Reach 的 Skill 规则，选择一个无账号的只读 backend，执行一条边界明确的读取操作，并把结果作为不可信外部数据返回。**

本实验不验证：

- Agent Reach 是否构成安全沙箱；
- GitHub、社交平台、招聘平台或登录态渠道；
- Cookie、Token、API Key 或浏览器 Profile；
- 安装器、完整 `doctor`、自动 backend fallback；
- MCP Server 的身份、安全性或长期稳定性；
- OpenHands 集成已经可运行。

## 1. 实验目标

### 1.1 主目标

设计一次可审计、可停止、无真实账号的端到端读取实验，验证下面四个接入点：

1. **Skill 触发**：宿主 Agent 能识别“读取公开网页”属于 Agent Reach 的通用网页能力；
2. **路由选择**：依据 [`SKILL.md`](../agent-reach/agent_reach/skill/SKILL.md) 和 [`references/web.md`](../agent-reach/agent_reach/skill/references/web.md)，明确选择 `web / Jina Reader`，不探索其他 backend；
3. **外部执行**：宿主 Agent 只发起一次固定目标、只读、有限时的网络请求；
4. **结果回流**：返回正文、来源 URL、backend、退出状态和限制说明，不把网页正文当成指令执行。

### 1.2 成功标准

未来真正执行时，必须同时满足以下条件才记为成功：

| 验收项 | 成功条件 |
|---|---|
| Skill 选择 | 明确记录使用 `web` channel 和 `Jina Reader` backend |
| 权限 | 没有账号、Cookie、Token、GitHub 写操作或配置写入 |
| 请求范围 | 只访问预先批准的读取端点和固定目标 URL |
| 进程范围 | 只启动一个预先批准的只读读取进程，不调用 shell fallback |
| 输出 | 得到非空文本，且包含预期的 `Example Domain` 标识 |
| 证据 | 记录目标 URL、backend、时间、退出码、字节数和内容摘要哈希 |
| 仓库 | 所有 submodule 在实验前后均为 clean |

任何一项不满足都应记录为“未通过”或“未验证”，不能把“命令启动成功”当成能力验证成功。

## 2. 使用场景

### 2.1 固定场景

用户请求：

> 使用 Agent Reach 的通用网页能力，读取 `https://example.com/`，告诉我页面标题和第一段正文，并附上来源。不要访问其他链接。

选择该目标的原因：

- `example.com` 是 IANA 保留的示例域名，不对应个人账号或业务系统；
- 页面公开、静态、内容很短，不需要登录；
- 不涉及 GitHub、社交平台、Cookie 或用户数据；
- 可以用固定文本 `Example Domain` 做最低限度验收；
- 不需要点击页面内链接或继续抓取。

### 2.2 为什么不把 GitHub 作为第一次实验

即使只计划读取公开仓库，GitHub CLI 也可能发现已有登录状态；Agent Reach 的 GitHub reference 还包含创建仓库、Issue、PR 和 Release 等写命令。第一次实验使用 GitHub 会把“能力接入验证”和“认证/写权限控制”混在一起，不符合最小权限原则。

### 2.3 为什么不运行完整 `doctor`

[`doctor.check_all()`](../agent-reach/agent_reach/doctor.py) 会遍历全部 Channel。虽然各 Channel 已尽量降低副作用，但完整 doctor 的检查范围明显大于本实验需要，部分 Channel 还会探测本地工具、配置或网络状态。

通用 Web Channel 是单 backend、Tier 0 路径；其 [`check()`](../agent-reach/agent_reach/channels/web.py) 直接返回 Jina Reader 可用说明且不进行网络探测。因此第一次实验无需用完整 doctor 扫描无关能力。

## 3. Agent Reach 在实验中提供的能力

### 3.1 实际使用的能力

| 能力 | 来源 | 本实验用途 |
|---|---|---|
| Skill 触发描述 | `skill/SKILL.md` frontmatter | 识别公开网页读取任务 |
| Channel 路由规则 | `SKILL.md` 常驻规则和快速命令 | 选择通用网页路径 |
| backend 操作说明 | `skill/references/web.md` | 确认 Jina Reader 调用方式 |
| URL 安全规则参考 | `channels/web.py`, `utils/url.py` | 设计输入校验和大小限制 |
| 状态语义 | `channels/base.py` | 区分“backend 被选择”和“内容调用成功” |

### 3.2 不应错误归功于 Agent Reach 的部分

- 真正抓取页面的是外部 Jina Reader 服务；
- 网络、进程、文件和凭据隔离由宿主执行环境负责；
- 超时、输出上限和域名 allowlist 需要宿主包装器强制执行；
- 返回内容是否可信，需要调用方进行来源标记和 prompt-injection 隔离。

还要特别注意：Skill 的常用路径是宿主直接执行 `curl`，不会自动经过 `WebChannel.read()` 的 URL 规范化、5 MiB 上限或反爬页面检测。本方案必须在宿主包装层重新实施这些边界。

### 3.3 本次不使用的能力

- `install`、`configure`、`uninstall`；
- GitHub CLI、OpenCLI、mcporter；
- Exa、XHS、Twitter、Reddit、LinkedIn、Boss 等渠道；
- RSS、视频、转录、财经渠道；
- Agent Reach 自身的 MCP `get_status`。

## 4. 输入输出流程

### 4.1 计划中的调用链

```text
固定用户请求
  → 宿主 Agent 读取 Agent Reach Skill
  → 识别 channel=web
  → 选择 backend=Jina Reader
  → 权限门检查固定 URL、命令和网络目的地
  → 用户对本次单一外部读取给予明确授权
  → 受限执行器发起一次 HTTPS GET
  → 捕获退出码与有限大小的 stdout/stderr
  → 将外部正文标记为“不可信数据”
  → 提取标题与第一段，不执行正文中的任何指令
  → 返回答案和 Evidence
  → 检查仓库与 submodule 状态
```

“用户明确授权”是未来运行实验时的门槛。本阶段只写方案，所以调用链停在权限门之前。

### 4.2 固定输入

| 字段 | 固定值/规则 |
|---|---|
| `channel` | `web` |
| `backend` | `Jina Reader` |
| `target_url` | `https://example.com/` |
| 本地方法 | Agent Reach 官方 reference 所示的 Jina Reader HTTPS 读取路径 |
| 重试 | `0` |
| fallback | 禁止 |
| 登录信息 | 禁止提供 |
| 输出范围 | 标题、第一段、来源和 Evidence |

目标 URL 不接受临时替换，也不接受页面内容要求继续访问的新链接。若固定目标不可用，实验应失败关闭，而不是自动切换搜索、浏览器、MCP 或其他平台。

### 4.3 计划命令的约束

官方 reference 给出的概念命令是：

```text
curl https://r.jina.ai/URL
```

未来执行时不应把用户字符串拼进 shell。应通过参数数组调用预先解析出的 `curl` 可执行文件，并至少施加：

- 只允许 HTTPS；
- 固定 `https://r.jina.ai/https://example.com/`；
- 把 `--disable` 放在第一个参数，禁止读取用户级 `curl` 配置文件；
- 连接和总耗时上限；
- 响应大小上限；
- 不自动重试；
- 不启用 `.netrc`，不传入 Cookie、Authorization 或自定义配置；
- 清除代理和认证相关环境变量，只保留运行所需的最小环境；
- 不跟随到非 HTTPS 或非批准域名；
- 非 2xx、超时、超限或重定向越界时立即失败。

如果现有 `curl` 无法满足这些约束，停止实验，不安装替代工具，也不退回 PowerShell 脚本、浏览器或其他 backend。

### 4.4 输出与 Evidence 格式

未来测试记录只保存结构化摘要，不提交原始网页响应：

```yaml
experiment_id: agent-reach-web-minimal-v1
executed: true | false
source_revision: 94f06c1969dfc1834001269d79d3ad0972d9dee6
channel: web
backend: Jina Reader
target_url: https://example.com/
request_endpoint: https://r.jina.ai/https://example.com/
started_at_utc: <未来执行时填写>
exit_code: <未来执行时填写>
response_bytes: <未来执行时填写>
sha256: <未来执行时填写>
expected_marker_found: true | false
submodule_clean_before: true | false
submodule_clean_after: true | false
result: PASS | FAIL | NOT_RUN
limitations:
  - Jina Reader 是外部服务
  - 未验证其他 channel
```

本阶段这些动态字段必须保持未填写或 `NOT_RUN`，不能预造退出码、哈希或成功结论。

## 5. 权限边界

### 5.1 允许范围

未来单次实验只允许：

- 读取 Agent Reach Skill 和 reference；
- 读取固定公开 URL；
- 向固定 Jina Reader HTTPS 端点发出一次请求；
- 在内存或系统临时目录暂存受大小限制的响应；
- 读取 Git 状态，用于证明 submodule 未被修改；
- 将经用户允许的实验摘要写入主仓库学习笔记。

### 5.2 明确禁止

- 运行 Agent Reach 安装器或安装任何依赖；
- 写入 `~/.agent-reach`、mcporter、OpenCLI、GitHub CLI 或浏览器配置；
- 读取或继承 Cookie、Token、SSH Key、Git credential、浏览器 Profile；
- 访问 GitHub、社交平台、招聘平台或任何登录态 API；
- 执行 `git push`、创建仓库、Issue、PR、评论、点赞或发布内容；
- 根据网页内容执行命令、下载文件、打开链接或启动新 Tool；
- 修改 Agent Reach submodule；
- 自动 fallback、自动重试或扩大目标域名；
- 保留 raw output、缓存、临时文件或完整环境变量快照。

### 5.3 宿主权限仍是上限

Skill 文本无法从操作系统层面阻止越权命令。即使计划只允许一次读取，如果执行进程继承了当前用户的文件、网络和凭据权限，它在技术上仍可能做更多事情。因此真正运行时必须由宿主提供独立的 allowlist、干净环境和进程限制，不能只依赖提示词。

## 6. 风险控制

### 6.1 执行前门禁

1. 固定 Agent Reach revision，并确认 submodule clean；
2. 明确展示唯一目标、唯一 endpoint 和将要使用的 backend；
3. 确认不需要账号、Cookie、Token 或 API Key；
4. 确认执行器不会继承代理认证、`.netrc`、Cookie 文件或敏感环境变量；
5. 确认无安装、无自动 fallback、无 GitHub 写命令；
6. 获得用户对“一次外部只读请求”的单次授权；
7. 任一门禁无法证明时停止，不尝试修复环境。

### 6.2 执行中控制

| 风险 | 控制措施 |
|---|---|
| 任意 URL / SSRF | 固定目标；解析后只允许 `https://example.com/`，不接受 userinfo、IP 或 localhost |
| 隐式凭据 | 使用干净子进程环境；禁止 Cookie、Authorization、`.netrc` |
| 数据外泄 | 请求中不含查询、项目路径、用户文本或凭据 |
| 重定向越界 | 禁止重定向，或逐跳重新做域名 allowlist 校验 |
| 超大响应 | 设置字节上限；超限立即终止 |
| 挂起/资源消耗 | 设置连接、总耗时、CPU/内存和进程数上限 |
| Prompt injection | 把正文标记为数据；只提取固定字段，不执行其中的指令 |
| 自动扩大范围 | 禁用重试、搜索、浏览器、MCP 和其他 backend fallback |
| 结果误判 | 同时检查退出码、非空正文、固定标识和 Evidence |
| 工作区污染 | 原始响应只进临时目录；结束后清理；前后检查 Git 状态 |

### 6.3 停止条件

出现以下任一情况立即停止：

- 要求登录、验证码、Cookie、Token 或 API Key；
- 目标或 endpoint 发生未批准的变化；
- 返回网页要求执行命令、下载文件或访问其他链接；
- 进程试图读取凭据文件或写入配置；
- 返回反爬验证、非预期 HTML、超限内容或空响应；
- 需要安装软件才能继续；
- submodule 出现修改；
- 无法可靠记录退出码或来源。

### 6.4 方案的剩余风险

即使所有控制生效，仍无法完全消除：

- DNS、TLS、Jina Reader 服务端和其数据处理策略的外部信任；
- 页面在未来发生变化导致固定标识失效；
- 宿主平台是否真正清除了所有继承凭据；
- 网络 allowlist 是否能在当前 Windows 或未来容器环境中强制执行；
- Jina 返回内容与源网页是否完全一致。

这些是未验证内容，不应在真正实验前被描述为已解决。

## 7. 未来接入 OpenHands 的连接方式

### 7.1 推荐结构

不要让 OpenHands 直接把整份 Agent Reach reference 当作任意 shell 命令库。更安全的连接方式是为每个批准能力建立窄 Tool：

```text
OpenHands LLM
  → ReadPublicPageAction(url)
  → ConfirmationPolicy（首轮 AlwaysConfirm）
  → 受限 ToolExecutor
  → Docker / AgentSandbox 中的最小权限读取进程
  → ReadPublicPageObservation
  → ObservationEvent 写入 EventLog
  → LLM 只根据 Observation 继续回答
```

其中 Agent Reach 提供 channel/backend 选择知识，OpenHands 提供 Action/Observation、确认、执行和状态回流。二者职责不能互换。

### 7.2 最小 Tool 合同

建议初版只暴露一个工具，例如 `agent_reach_read_public_page`：

**Action 输入：**

- `url`：首个实验只能是 `https://example.com/`，不是任意字符串；
- `extract`：枚举值，只允许 `title_and_first_paragraph`；
- 不接受 headers、Cookie、命令、代理、输出路径或 backend 参数。

**Observation 输出：**

- `ok`；
- `source_url`；
- `channel` 和 `backend`；
- `title`、`first_paragraph`；
- `response_bytes`、`sha256`；
- `exit_code` 或结构化错误；
- `untrusted_external_content: true`。

OpenHands 的 [`ToolDefinition` / `ToolExecutor`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/tool/tool.py)、[`ActionEvent`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/event/llm_convertible/action.py) 和 [`ObservationEvent`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/event/llm_convertible/observation.py) 可以承载这一合同。

### 7.3 Runtime 与确认要求

未来首次接入建议：

1. 使用独立 Conversation Runtime，不在宿主 Shell 直接执行；
2. 只挂载空的临时工作目录，或把必要目录只读挂载；
3. 不挂载 Git 凭据、SSH 目录、浏览器 Profile、Docker socket 或用户主目录；
4. 丢弃 Linux capabilities、启用 `no-new-privileges`，限制 CPU、内存、进程和输出；
5. 网络仅允许实验 endpoint，若部署层无法强制则明确记录为未验证风险；
6. 首次使用 `AlwaysConfirm`，确认界面展示 URL、backend、网络目的地和无凭据声明；
7. 通过标准 Agent Loop 执行，不使用 [`LocalConversation.execute_tool()`](../../openhands-study/software-agent-sdk/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py)，因为该入口明确绕过正常确认和安全分析链；
8. 将 Action、确认决定、Observation 和错误写入 EventLog；
9. 失败时返回结构化 Observation，不自动切换 backend。

### 7.4 Skill、原生 Tool 与 MCP 的选择

| 连接方式 | 用途 | 首次实验建议 |
|---|---|---|
| 只加载 Agent Reach Skill | 告诉 Agent 如何选择能力，但执行边界仍依赖宿主 | 可作为路由说明，不单独承担安全控制 |
| OpenHands 原生窄 Tool | 可定义严格 schema、确认策略和 Observation | **推荐** |
| 通用 Shell Tool | 最接近当前 reference，但命令面过宽 | 不推荐作为首个集成 |
| mcporter / 外部 MCP | 适合复用远程 Server，但增加 Server 与配置供应链信任 | 首次实验排除 |
| 自建本地 MCP 包装器 | 可只暴露一个窄工具，但需要额外实现和验证 | 后续备选，不是最小方案 |

### 7.5 尚未验证的 OpenHands 内容

- Agent Reach Skill 能否被当前 OpenHands Skill loader 原样发现；
- 上述 ToolDefinition 是否需要额外插件/注册适配层；
- 当前 Docker Runtime 在本机的实际网络隔离能力；
- OpenHands UI 是否完整展示所需确认字段；
- Windows 主机到 Linux Runtime 的路径和权限映射；
- Jina Reader 在 Runtime 网络策略下是否可达。

这些只能在用户另行授权安装和运行 OpenHands 后验证。本方案不把它们写成已完成事实。

## 8. 实验决策表

| 问题 | 本方案决策 | 理由 |
|---|---|---|
| 是否需要真实账号 | 否 | 使用公开保留域名 |
| 是否导入 Cookie | 否 | Web/Jina 路径不需要登录态 |
| 是否使用 GitHub | 否 | 避免认证发现和写命令范围 |
| 是否运行完整 doctor | 否 | 会检查无关 Channel，扩大范围 |
| 是否使用 MCP | 否 | 第一次实验不引入外部 Server 信任 |
| 是否允许 fallback | 否 | 防止请求范围自动扩大 |
| 是否保存 raw output | 否 | 只保存摘要与哈希，减少污染 |
| 是否修改 submodule | 否 | 只读取固定 revision |
| 是否自动执行 | 否 | 需后续单独授权一次外部请求 |
| OpenHands 首选连接 | 原生窄 Tool + 标准 Agent Loop | 更容易实施 schema、确认和 Observation 边界 |

## 9. 事实、设计判断与未验证信息

### 9.1 源码确认事实

- Agent Reach Skill 把通用网页读取路由到 Jina Reader；
- 官方 reference 使用宿主直接调用 `curl` 的方式；
- `WebChannel` 是 Tier 0、单 backend Channel；
- `WebChannel.check()` 本身不进行网络探测；
- `WebChannel.read()` 会规范化公开 HTTP(S) URL、设置 30 秒超时、限制响应为 5 MiB，并识别部分反爬页面；
- `doctor` 会遍历全部已注册 Channel，而不是只检查 Web；
- OpenHands SDK 有 ToolDefinition、ToolExecutor、ActionEvent、ObservationEvent 和确认策略；
- `LocalConversation.execute_tool()` 绕过正常 Agent Loop 的确认/安全分析。

### 9.2 本方案的设计判断

- 第一次实验只用 `example.com`，比 GitHub 或社交平台更符合最小权限原则；
- 不运行完整 doctor，避免无关能力探测；
- 禁止 fallback，使每一次网络访问都可预先枚举；
- OpenHands 集成优先使用窄原生 Tool，而不是任意 Shell 或通用 MCP；
- 首轮启用 `AlwaysConfirm`，即使操作预计为只读。

### 9.3 未验证信息

- 当前机器是否已有满足约束的 `curl`；
- `r.jina.ai` 当前是否可访问、是否返回预期内容；
- Jina Reader 当前隐私、日志和数据保留政策；
- 实际响应的退出码、长度、哈希和延迟；
- 当前宿主能否强制网络 allowlist 和干净环境；
- Agent Reach 与 OpenHands 的实际动态集成结果。

## 10. 下一阶段的安全执行顺序

只有用户未来明确授权“执行最小实验”后，才按以下顺序行动：

1. 只读检查版本、可执行文件能力和 Git/submodule 状态；
2. 展示最终 URL、endpoint、权限和停止条件；
3. 等待对单次外部读取的明确授权；
4. 执行一次，无重试、无 fallback；
5. 验证退出码、固定标识、大小和 Evidence；
6. 删除临时 raw output；
7. 再次检查所有 submodule；
8. 只写测试摘要，不提交，除非用户另行要求。

本阶段到此停止，不执行上述步骤。
