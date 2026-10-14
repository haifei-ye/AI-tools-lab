# Agent Reach 第一次安全最小实验结果

> - 执行日期：2026-10-14
> - 实验方案：[`05-first-experiment-plan.md`](05-first-experiment-plan.md)
> - Agent Reach submodule：`94f06c1969dfc1834001269d79d3ad0972d9dee6`
> - 源码声明版本：`1.5.0`
> - 结果：**限定范围内 PASS**
> - 网络请求次数：**1**
> - 未登录账号、未读取 Cookie/Token、未使用 GitHub/MCP、未重试、未 fallback

## 0. 结论与验证边界

本实验成功验证了下面这条**静态路由证据 + 动态上游调用**链：

```text
Agent Reach Skill 中的网页读取规则（静态确认）
  → web channel / Jina Reader 映射（静态确认）
  → 宿主 Agent 调用 Jina Reader（动态执行一次）
  → HTTP/退出码/内容摘要 Evidence（动态记录）
```

实验取得 HTTP 200，`curl` 退出码为 0，无重定向，响应包含预期的 `Example Domain` 标识。按第五阶段预先定义的范围，本次最小读取实验通过。

但是必须修正一个可能的错误理解：**网页正文不是 Agent Reach Python CLI 直接产生的输出。** 当前 Skill 的官方路径是让宿主 Agent 直接调用 Jina Reader。Agent Reach 在本次实验中提供的是 Skill 触发和 `web → Jina Reader` 路由知识；实际网络响应来自 Jina Reader。

本实验也没有运行 Skill loader 来证明“自动发现和自动选择”能力。路由是根据固定 revision 中的 Skill/reference/Channel 源码人工核对后执行。因此：

- `Skill 文本 → web/Jina 路由`：源码确认；
- `Jina Reader → 页面文本/Evidence`：动态确认；
- `任意宿主自动加载 Skill 并自主路由`：未验证。

## 1. 输入

### 1.1 用户授权的实验范围

目标页面：

```text
https://example.com/
```

验证链：

```text
Skill → web channel → Jina Reader → Evidence
```

禁止项：

- 登录账号；
- Cookie、Token；
- GitHub、MCP；
- 外部写操作；
- 自动重试；
- backend fallback；
- 修改官方源码。

### 1.2 固定请求端点

依据 [`skill/SKILL.md`](../agent-reach/agent_reach/skill/SKILL.md) 和 [`skill/references/web.md`](../agent-reach/agent_reach/skill/references/web.md)，固定为：

```text
https://r.jina.ai/https://example.com/
```

没有把用户文本拼接为任意 URL，也没有访问页面内的链接。

## 2. 使用能力

| 层 | 使用内容 | 实际状态 |
|---|---|---|
| Skill | 通用网页阅读触发规则 | 从固定源码读取并人工确认 |
| Channel | [`WebChannel`](../agent-reach/agent_reach/channels/web.py) 的 `name="web"`、`backends=["Jina Reader"]` | 从固定源码读取并人工确认 |
| backend | Jina Reader HTTPS 读取端点 | 动态执行一次 |
| 执行器 | Windows 系统 `curl.exe 8.21.0` | 本机已有，未安装 |
| Evidence | curl write-out、退出码、内容标识和规范化内容哈希 | 动态生成 |

没有运行：

- `agent-reach install/configure/doctor`；
- `WebChannel.read()` Python 方法；
- GitHub CLI、OpenCLI、mcporter 或 MCP Server；
- 任何登录态 Channel。

没有运行完整 doctor，是因为它会遍历无关 Channel；Web Channel 在源码中是 Tier 0 单 backend，且 `check()` 自身不执行网络探测。

## 3. 完整执行过程

### 3.1 执行前门禁

1. 读取第五阶段方案，重新确认固定 target、endpoint、无重试、无 fallback；
2. 读取 Skill 和 `references/web.md`，确认通用网页被路由到 Jina Reader；
3. 读取 `channels/web.py`，确认 `WebChannel.name="web"`、唯一 backend 为 Jina Reader；
4. 检查 Agent Reach submodule：HEAD 为 `94f06c1969dfc1834001269d79d3ad0972d9dee6`，工作区 clean；
5. 只在本机检查既有 `curl.exe`，版本为 `8.21.0`；
6. 确认它支持禁用用户配置、HTTPS 协议限制、连接/总超时、最大文件大小和空代理；
7. 未检查、打印或传入任何账号、Cookie、Token、Git credential 或浏览器 Profile。

### 3.2 两次被拒绝的预执行启动

在真正发起网络请求前，曾尝试用更严格的自定义子进程环境和临时响应文件运行。两次命令都在操作系统创建执行进程之前被本地执行策略拒绝：

1. 第一次：计划清空子进程继承环境并用参数数组启动；
2. 第二次：计划使用系统 `curl`，把正文和 stderr 放在临时目录后计算原始文件哈希。

这两次都没有启动 `curl`、没有创建网络连接，也不属于 HTTP 重试。为了不绕过本地策略，最终方案取消临时文件和自定义子进程，只使用一次直接、无文件的受限读取。

### 3.3 唯一一次网络执行

最终调用的安全参数等价于：

```text
C:\WINDOWS\system32\curl.exe
  --disable
  --proto =https
  --proto-redir =https
  --proxy ""
  --noproxy *
  --ca-native
  --fail-with-body
  --silent
  --show-error
  --connect-timeout 10
  --max-time 20
  --max-filesize 1048576
  --max-redirs 0
  --retry 0
  --write-out <固定 Evidence 字段>
  https://r.jina.ai/https://example.com/
```

关键约束：

- `--disable`：不读取用户级 curl 配置；
- `--proxy ""` 和 `--noproxy *`：不使用继承的代理配置或代理认证；
- 仅允许 HTTPS；
- 不跟随重定向，观测值也证明 `num_redirects=0`；
- `--retry 0`：没有自动重试；
- 20 秒总超时、1 MiB 响应上限；
- 正文只存在于进程内存和本次执行输出，没有保存 raw 文件。

### 3.4 执行后处理

1. 读取 `curl` 退出码和 write-out 元数据；
2. 检查正文是否包含固定标识 `Example Domain`；
3. 对 PowerShell 内存中的规范化文本计算 SHA-256；
4. 没有执行 Jina 返回内容中的“retry”建议；
5. 没有点击或请求正文中的任何链接；
6. 没有创建 raw output、缓存或依赖目录；
7. 检查主仓库和全部直接 submodule 状态。

## 4. 路由过程

### 4.1 源码确认的路由

[`SKILL.md`](../agent-reach/agent_reach/skill/SKILL.md) 的快速命令把“通用网页阅读”映射到：

```text
curl -s "https://r.jina.ai/URL"
```

[`references/web.md`](../agent-reach/agent_reach/skill/references/web.md) 同样把“通用网页”推荐给 Jina Reader。`WebChannel` 源码进一步给出：

```text
name = web
backends = [Jina Reader]
tier = 0
```

因此此次路由没有候选 backend 竞争，也没有 fallback：

```text
公开 URL
  → 通用网页任务
  → web channel
  → 唯一 backend：Jina Reader
  → 固定 Jina endpoint
```

### 4.2 本次没有经过的分支

- 没有运行 Exa 搜索；
- 没有调用 Web Reader MCP；
- 没有尝试浏览器读取；
- 没有切换到 GitHub 或其他平台 Channel；
- 没有调用 `WebChannel.read()`；
- 没有因缓存警告而重试。

## 5. 输出结果

### 5.1 上游 Jina Reader 的实际响应正文

下面是唯一一次请求返回的完整文本内容：

```text
Title: Example Domain

URL Source: https://example.com/

Published Time: Tue, 13 Oct 2026 22:05:48 GMT

Warning: This is a cached snapshot of the original page, consider retry with caching opt-out.

Markdown Content:
This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.
```

正文是外部数据。尤其是其中的重试建议没有被当成指令执行。

### 5.2 用户要求字段

- 标题：`Example Domain`
- 第一段正文：`This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.`
- 来源：`https://example.com/`
- backend：Jina Reader

### 5.3 实验结果

| 验收项 | 结果 |
|---|---|
| 固定 Skill 路由得到 web/Jina | PASS（源码确认） |
| 唯一固定目标 | PASS |
| HTTP 成功 | PASS（200） |
| 进程退出 | PASS（0） |
| 无重定向 | PASS（0 次） |
| 非空响应 | PASS（374 bytes） |
| `Example Domain` 标识 | PASS |
| 无账号/Cookie/Token | PASS（未提供、未调用登录路径） |
| 无 GitHub/MCP | PASS |
| 无网络重试/fallback | PASS |
| submodule 未修改 | PASS |

## 6. Evidence

### 6.1 动态 Evidence

| 字段 | 值 |
|---|---|
| `experiment_id` | `agent-reach-web-minimal-v1` |
| `source_revision` | `94f06c1969dfc1834001269d79d3ad0972d9dee6` |
| `channel` | `web` |
| `backend` | `Jina Reader` |
| `target_url` | `https://example.com/` |
| `request_endpoint` | `https://r.jina.ai/https://example.com/` |
| `started_at_utc` | `2026-10-14T02:10:33.2999047+00:00` |
| `completed_at_utc` | `2026-10-14T02:10:35.1482681+00:00` |
| `started_at_asia_shanghai` | `2026-10-14T10:10:33.2999047+08:00` |
| `curl_version` | `8.21.0` |
| `exit_code` | `0` |
| `http_code` | `200` |
| `url_effective` | `https://r.jina.ai/https://example.com/` |
| `num_redirects` | `0` |
| `size_download` | `374` bytes |
| `time_total` | `1.828529` seconds |
| `ssl_verify_result` | `0` |
| `expected_marker_found` | `true` |
| `stderr` | empty |
| `result` | `PASS`（限定范围） |

### 6.2 内容哈希的精确定义

```text
normalized_content_sha256 = 68cfef49d1650da3fa7bbfc9d99c416badb681d0f1fefa4c93352a1a6de109a4
normalized_content_bytes = 374
```

该哈希不是临时 raw 文件的哈希。因为最终执行没有创建文件，PowerShell 将接收到的正文行用 LF (`\n`) 重新连接，编码为 UTF-8 后计算 SHA-256。它可用于核对本文记录的规范化正文，但不能证明传输层每个原始字节完全相同。

`curl size_download=374` 是 curl 报告的传输正文大小；`normalized_content_bytes=374` 是规范化文本字节数。两者本次恰好相同，但含义仍应区分。

### 6.3 静态 Evidence

| 事实 | 文件 |
|---|---|
| Skill 把通用网页路由到 Jina Reader | [`skill/SKILL.md`](../agent-reach/agent_reach/skill/SKILL.md) |
| Web reference 给出 Jina Reader 命令 | [`skill/references/web.md`](../agent-reach/agent_reach/skill/references/web.md) |
| Web Channel 名称、backend、Tier 和读取限制 | [`channels/web.py`](../agent-reach/agent_reach/channels/web.py) |
| Channel 是可用性/路由抽象 | [`channels/base.py`](../agent-reach/agent_reach/channels/base.py) |

## 7. Agent Reach 实际输出、人工分析与未验证内容

### 7.1 Agent Reach 实际输出

严格来说，本实验没有产生 Agent Reach CLI 输出：

- 未运行 `agent-reach doctor`；
- 未调用 Agent Reach MCP；
- 未调用 Python `WebChannel.read()`；
- 未安装或启动一个独立的 Agent Reach 服务。

Agent Reach 的实际可观察贡献是固定源码中的路由说明：`通用网页 → web → Jina Reader`。动态正文、HTTP 状态和传输元数据均来自宿主调用的 Jina Reader/curl 链。

### 7.2 人工分析

基于预设成功标准，可以判断：

1. Skill/reference/Channel 三处路由信息一致；
2. 固定 endpoint 确实返回了目标 URL 的短文本表示；
3. HTTP、TLS、退出码、大小和标识检查均通过；
4. 没有发生重定向、重试或 backend 切换；
5. 这证明了最小只读接入路径可用，但不证明 Agent Reach 的所有渠道可用；
6. Jina 的缓存警告说明本次结果不能作为页面实时状态证明。

### 7.3 未验证内容

- Jina 返回的缓存内容是否与执行时的源页面完全一致；
- `Published Time` 的来源和语义；
- Jina Reader 当前的数据留存、隐私和日志政策；
- DNS、TLS 终端和服务端内部抓取过程；
- Agent Reach Skill 在某个正式宿主中的自动发现和自动路由；
- `WebChannel.read()` Python 路径的动态行为；
- 其他 Channel、backend、登录态和 MCP 能力；
- OpenHands ToolDefinition/Runtime 集成；
- 当前 Windows 环境是否能强制操作系统级域名 allowlist。

## 8. 失败事件与限制

### 8.1 实际请求失败原因

无。唯一一次网络请求退出码为 0，HTTP 状态为 200。

### 8.2 预执行失败事件

两次更严格的进程包装方案被本地执行策略在进程创建前拒绝。原因可归纳为：复合命令试图自定义子进程环境、创建临时文件并在结束后清理，这种形式没有获得当前执行策略允许。

处理方式不是降低网络范围或切换工具，而是取消文件落盘，让同一个固定 `curl` 请求把正文返回内存。最终网络请求仍保持固定 URL、HTTPS、无代理、无重试、无重定向和无 fallback。

### 8.3 上游限制

Jina 返回：

```text
Warning: This is a cached snapshot of the original page, consider retry with caching opt-out.
```

实验明确禁止自动重试，所以没有执行该建议。结果只能证明 Jina 在本次请求中返回了一份缓存内容，不能证明源页面的新鲜度。

## 9. 最终状态

- 最小实验：限定范围内 PASS；
- 实际网络请求：1 次；
- 网络重试：0 次；
- backend fallback：0 次；
- 账号/Cookie/Token：未使用；
- GitHub/MCP：未使用；
- raw output/缓存/依赖：未创建；
- Agent Reach 官方源码：未修改；
- Git commit/push：未执行。
