# OpenHands Agent Layer 调用自建 MCP Server 实验结果

> 实验日期：2026-10-15
>
> 实验状态：**PASS**
>
> 实验范围：OpenHands Software Agent SDK `TestLLM` + FastMCP Client + 本地 stdio MCP Server
> 明确不包含：真实 LLM、Token/Cookie、外部 API、完整 OpenHands 生产环境、Shell/File/GitHub/Binance Tool

## 1. 实验目标

第五阶段已经用 TypeScript Client 验证 MCP 协议层：

```text
TypeScript Client
→ MCP Server
→ tools/list
→ tools/call
→ CallToolResult
```

本阶段新增验证 OpenHands Agent Layer：

```text
用户请求
→ OpenHands Agent / TestLLM
→ MCPToolDefinition
→ ActionEvent(MCPToolAction)
→ FastMCP Client
→ project-info-server
→ get_project_info
→ CallToolResult
→ MCPToolObservation
→ ObservationEvent
→ 下一轮 TestLLM
→ Conversation FINISHED
```

## 2. 实验环境

实验运行在独立 Ubuntu 电脑，而不是 Windows 或 WSL。

| 项目 | 实际值 |
|---|---|
| 主机 | `Ye123` |
| OS | Ubuntu 24.04.4 LTS |
| 架构 | `x86_64` |
| Kernel | `7.0.0-34-generic` |
| glibc | 2.39 |
| CPU | 8 个逻辑处理器 |
| 内存 | 7.7 GiB |
| Swap | 4.0 GiB，实验结束时使用 0 B |
| Python | 3.12.3 |
| uv | 0.12.16，独立安装 |
| Node.js | 24.18.0 Linux x64，独立目录 |
| npm | 11.16.0 |

隔离路径：

```text
/home/ethan/tools/uv-0.12.16
/home/ethan/tools/node-v24.18.0-linux-x64
/home/ethan/venvs/openhands-agent-test
/home/ethan/ai-tools-lab/software-agent-sdk
/home/ethan/ai-tools-lab/project-info-server
```

没有修改 Ubuntu 系统 Python，也没有持久修改系统 PATH。

## 3. 源码和依赖版本

### 3.1 Software Agent SDK

- 官方仓库：`https://github.com/OpenHands/software-agent-sdk.git`
- 固定提交：`7bd668c9ab74f62c85745cd95adb503f53e7228b`
- SDK：`openhands-sdk==1.54.0`
- `uv.lock` SHA-256：
  `3f2e19d0b6fa7604ecb40617447aa85f1722bb29bc60d85810c71a618391e702`

锁定安装使用：

```text
--locked
--package openhands-sdk
--no-dev
--no-python-downloads
--no-editable-package openhands-sdk
```

共安装 126 个运行依赖。关键版本：

| 包 | 版本 |
|---|---:|
| openhands-sdk | 1.54.0 |
| fastmcp | 3.2.0 |
| mcp | 1.28.1 |
| litellm | 1.93.0 |
| PyYAML | 6.0.2 |

Linux x64 wheel 覆盖完整，没有触发 LiteLLM、PyYAML、Rust 或 MSVC 源码编译。

### 3.2 project-info-server

只复制以下自建实验文件，没有复制 Windows 的 `node_modules`：

```text
README.md
package.json
package-lock.json
tsconfig.json
src/
```

- `package-lock.json` SHA-256：
  `367afde683f8e8b09e3be3d9e12792a0423a400d96cb4e2dfdb16337386e8867`
- `npm ci`：成功，安装 20 个包
- `npm run typecheck`：成功
- `tsx --version`：4.23.15

Node 24.18.0 Linux x64 压缩包通过 Node 官方 `SHASUMS256.txt` 校验。

## 4. OpenHands MCP 配置

实验只配置一个 stdio Server：

```python
MCPServer(
    transport="stdio",
    command="/home/ethan/tools/node-v24.18.0-linux-x64/bin/node",
    args=[
        "/home/ethan/ai-tools-lab/project-info-server/node_modules/tsx/dist/cli.mjs",
        "src/server.ts",
    ],
    cwd="/home/ethan/ai-tools-lab/project-info-server",
    env={},
    enabled=True,
    timeout=30.0,
)
```

Agent 构造时传入 `tools=[]`，没有注册 Terminal、File Editor、GitHub 或其他业务 Tool。运行时仍存在 SDK 自带的 `finish` 和 `think`，再加上动态发现的 `get_project_info`：

```json
["finish", "get_project_info", "think"]
```

## 5. TestLLM 脚本

TestLLM 固定返回两次响应：

1. 调用 `get_project_info`，参数为 `{}`；
2. 返回普通文本 `Project information received.`，结束 Agent loop。

因此没有真实模型选择的不确定性，也没有 LLM API 请求或费用。

## 6. 实际 Evidence

### 6.1 Tool Discovery

OpenHands 日志确认：

```text
Loaded 0 tools from spec
Created 1 MCP tools
```

运行时 `conversation.agent.tools_map` 中存在：

```text
get_project_info
```

这证明 FastMCP Client 已启动 TypeScript Server、执行 MCP 初始化和 `tools/list`，并创建 `MCPToolDefinition`。

### 6.2 ActionEvent

```json
{
  "event_id": "d6c80d53-4d30-4076-9769-25d59ed26c84",
  "tool_name": "get_project_info",
  "tool_call_id": "call_project_info_1",
  "action_type": "MCPToolAction",
  "data": {}
}
```

已验证：

- TestLLM 的 Tool Call 被 Agent 转换为 `ActionEvent`；
- Action 类型是 `MCPToolAction`；
- 参数通过 MCP schema 校验后仍为 `{}`。

### 6.3 MCP Tool 调用与 Observation

```json
{
  "event_id": "b67016fb-ba07-4066-8286-ae8f9425846b",
  "action_id": "d6c80d53-4d30-4076-9769-25d59ed26c84",
  "tool_name": "get_project_info",
  "tool_call_id": "call_project_info_1",
  "observation_type": "MCPToolObservation",
  "is_error": false,
  "content": [
    "[Tool 'get_project_info' executed.]",
    "{\"name\":\"AI-tools-lab\",\"module\":\"mcp-study\",\"stage\":5,\"purpose\":\"Understand a minimal MCP Server and Tool call flow\",\"dataSource\":\"fixed-local-data\"}"
  ]
}
```

`ObservationEvent.action_id` 与 `ActionEvent.event_id` 完全匹配，`tool_call_id` 也一致。这证明 Observation 是该 Action 的真实执行结果，而不是人工拼接内容。

### 6.4 Agent Loop

实际事件顺序：

```text
SystemPromptEvent
→ MessageEvent              # 用户请求
→ ActionEvent               # MCPToolAction
→ ObservationEvent          # MCPToolObservation
→ MessageEvent              # TestLLM 最终回复
```

最终状态：

```text
ConversationExecutionStatus.FINISHED
TestLLM call_count = 2
TestLLM remaining_responses = 0
```

这证明 MCP Observation 已进入下一轮 Agent 上下文，Agent 随后再次调用 TestLLM 并正常结束。

## 7. 首次尝试失败记录

第一次运行没有形成有效 PASS 结果，原因分为两项。

### 7.1 Evidence 脚本对象选择错误

`Conversation` 会在初始化过程中复制并替换 Agent。第一次脚本在 `conversation.run()` 后读取了构造时的原始 `agent.tools_map`，因此出现：

```text
RuntimeError: Agent not initialized; call _initialize() before use
```

这属于实验脚本问题，不是 SDK、MCP Server 或依赖问题。受控重试改为读取 `conversation.agent.tools_map`。

### 7.2 LiteLLM 默认网络行为

第一次导入 LiteLLM 时，它尝试从 GitHub 获取远程模型价格表；请求被连接重置，随后使用本地备份。没有 Token，也没有调用任何 LLM API，但这不符合本实验预期的完全本地边界。

受控重试设置：

```text
LITELLM_LOCAL_MODEL_COST_MAP=True
```

同时清空继承环境，只保留运行必需变量，并将 HTTP/HTTPS/ALL proxy 指向本机不可用端口。第二次运行没有再出现远程价格表请求。

## 8. 安全边界

### 已验证

- 使用 `TestLLM`，没有真实 LLM API；
- 启动环境不包含账号、Token 或 Cookie；
- MCP 只使用本机 stdio；
- Tool 只返回源码中的固定 JSON；
- Tool 没有读取文件、环境变量或网络；
- Agent 没有 Shell、File、GitHub、Binance 等 Tool；
- MCP Server 进程在 `Conversation.close()` 后已退出；
- 临时 Conversation workspace 和 persistence 目录已删除；
- 实验结束时没有残留 stage8 临时目录。

### 源码完整性

安装期间 setuptools 曾在远端 SDK 副本中生成：

```text
openhands-sdk/build/
openhands-sdk/openhands_sdk.egg-info/
```

两者均被确认是 Git 提交之外的构建产物后清理。最终远端 SDK 文件数恢复为 1909，与提交 `7bd668c9...` 的文件清单差异为 0；`uv.lock` 哈希也保持不变。

Windows 主仓库的 OpenHands、Software Agent SDK、REA、Agent Reach 和 MCP 官方 submodule 均保持 clean。

## 9. 与第五阶段 TypeScript Client 实验比较

| 项目 | 第五阶段 | 第八阶段 |
|---|---|---|
| 调用发起者 | TypeScript MCP Client | OpenHands Agent / TestLLM |
| Tool 发现 | Client 直接 `tools/list` | FastMCP Client → `MCPToolDefinition` |
| Tool 选择 | 实验代码直接指定 | TestLLM 生成 Tool Call |
| 执行事件 | 无 Agent Event | `ActionEvent(MCPToolAction)` |
| 返回对象 | `CallToolResult` | `MCPToolObservation` + `ObservationEvent` |
| 下一轮上下文 | 无 | Observation 被下一轮 TestLLM 消费 |
| `structuredContent` | Client 可直接读取 | 当前 OpenHands Observation 只保留转换后的内容块 |

第五阶段证明 MCP 协议本身可用；第八阶段进一步证明 OpenHands Agent Layer 能把 MCP Tool 纳入真实 Agent loop。

## 10. 结论与限制

### 新增已验证事实

```text
OpenHands Agent
→ MCPToolDefinition
→ ActionEvent(MCPToolAction)
→ FastMCP Client
→ TypeScript project-info-server
→ get_project_info
→ MCPToolObservation
→ ObservationEvent
→ 下一轮 TestLLM
```

该完整链路已真实运行并通过。

### 仍未验证

- 真实 LLM 是否会稳定选择该 Tool；
- HTTP/SSE MCP Transport；
- 多 Tool、多 Server、超时和断线重连；
- 完整 OpenHands Agent Server/Web/Runtime；
- 生产环境权限隔离和并发行为。

这些内容不影响本阶段结论：**OpenHands Software Agent SDK 的 Agent Layer 已成功调用自建 MCP Server，并将结果转换为 Observation 进入下一轮决策。**
