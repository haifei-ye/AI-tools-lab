# Filesystem MCP Server 源码研究

> - 研究日期：2026-10-14
> - 官方仓库：`modelcontextprotocol/servers`
> - submodule 提交：`bbb701e7ac1e57f3edd1c2836b94c5457eaf7b9c`
> - Git 描述：`v1.0.0-2-gbbb701e7`
> - Filesystem package：`@modelcontextprotocol/server-filesystem@1.0.0`
> - 源码语言：TypeScript，ES Modules
> - 方法：REA 静态分析尝试 + 人工源码阅读
> - 未安装依赖、未构建、未启动 Server、未调用文件 Tool、未修改官方源码

## 0. 结论与前提修正

本阶段研究的是官方 [`modelcontextprotocol/servers`](../servers/official-servers/README.md) 中的 Filesystem reference server。它是一个真实、可发布的 MCP Server 实现，但官方仓库明确警告：这些实现用于演示协议与 SDK，不应未经威胁建模就当作 production-ready 产品。

开始分析前需要修正四个前提：

1. **当前 Filesystem Server 不是 MCP Resource Server。** 它只声明 `tools` capability，注册 14 个 Tool，没有调用 `registerResource()`，因此不会响应 `resources/list` 或 `resources/read`。
2. `read_media_file` 对普通二进制文件返回 embedded `resource` content block；这是 **Tool result 的一种内容类型**，不是可发现的 MCP Resource。
3. 当前快照仍使用 `@modelcontextprotocol/sdk` 1.x、`oninitialized` 和 Server 发起的 `roots/list`。测试注释明确把行为描述为 SDK 1.x wire contract，并提到未来 SDK v2 migration。因此它对应上一阶段中的 legacy session 模型，不应被当成 `2026-07-28` stateless core 的示例。
4. README 的 Features 写有“Create/list/delete directories”，但源码注册表中没有 delete Tool。本文以 `server.ts` 和协议级测试确认的 14 个 Tool 为准。

## 1. 分析方法与 REA 结果

### 1.1 为什么可以尝试 REA

Filesystem Server 使用 TypeScript，属于 REA JavaScript/TypeScript 静态分析的目标范围。因此本阶段先用现有 REA 源码构建分析：

```text
D:\AI-tools-lab\mcp-study\servers\official-servers\src\filesystem
```

没有安装 REA 或目标项目依赖，没有保存 raw output，也没有启动目标 Server。

### 1.2 【REA 实际输出】

| 项目 | 结果 |
|---|---|
| exit code | `1` |
| 目标格式 | `directory` |
| 计划分析的 source files | 23 |
| Evidence ID | `ev_42ef7a1c64ebed2b3c17bcc64df3e4b8ec9bfbae626f05b6200ad003fe484633` |
| Subject SHA-256 | `29baf9e9668b6b55abd9b8023cd1017c7418d7a14656c8d6d97a72f03bda9070` |
| Inventory manifest | `agm_7c1a74586c3966c76aabb38a6ceeb01b1e9bf0c8de3fdedc9bd39430f90471ab` |
| Inventory graph SHA-256 | `c75c92b26839e31b5908ab64ec212925fa76bbbe0abfbc1b593e1ca75d965a2a` |
| 失败原因 | 当前 Windows REA 构建缺少 `native/windows/build/manifest.json` |

REA 完成了目标身份与文件 inventory，但在第一个 TypeScript 文件的 AST 投影阶段停止。输出把语义关系标记为 partial/unavailable，不能据此声称已经自动恢复 `registerTool → handler → fs` 的函数调用图。

### 1.3 【人工源码阅读】

由于 REA 的语义分析没有完成，下面的入口、Tool 注册、schema、Roots、路径校验和调用链均来自固定 commit 的人工源码阅读，并用仓库的 protocol-level tests 交叉核对。

### 1.4 【未验证】

- 没有执行 npm install、build 或 tests；
- 没有建立 MCP Client/Server 连接；
- 没有让 Server 读取或写入任何真实目录；
- 没有验证发布到 npm 的 tarball 与本地 commit 是否字节一致。

## 2. MCP Server 项目结构

官方仓库是 npm workspaces monorepo，Filesystem Server 位于 `src/filesystem/`：

```text
official-servers/
├─ package.json                 # npm workspaces 根配置
├─ LICENSE                      # 正在从 MIT 迁移至 Apache-2.0 的仓库级许可说明
└─ src/filesystem/
   ├─ index.ts                  # npm bin / stdio 启动入口
   ├─ server.ts                 # McpServer、14 个 Tool、Roots 生命周期
   ├─ lib.ts                    # 文件读写、移动、搜索、编辑和 validatePath
   ├─ path-validation.ts        # allowed-directory 包含关系判断
   ├─ path-utils.ts             # Windows/WSL/Unix 路径规范化与 ~ 展开
   ├─ roots-utils.ts            # Client Roots URI 解析与目录验证
   ├─ version.ts                # 从 package.json 解析 Server version
   ├─ package.json              # 包、bin、依赖与脚本
   ├─ tsconfig*.json            # 构建/测试 TypeScript 配置
   ├─ vitest.config.ts          # 测试与覆盖率设置
   ├─ Dockerfile                # 官方容器构建参考
   ├─ README.md                 # 使用、Tool 与 Roots 文档
   └─ __tests__/                # 协议级、路径安全、Roots、stdio 测试
```

### 【源码确认事实】

- `package.json` 把 `dist/index.js` 注册为 `mcp-server-filesystem` 可执行文件；
- 当前依赖 `@modelcontextprotocol/sdk ^1.31.0`、Zod 4、minimatch、glob 和 diff；
- TypeScript 构建输出到 `src/filesystem/dist/`；
- 仓库开发要求 Node 22，但本阶段没有安装或切换运行环境；
- `__tests__/helpers.ts` 使用真实 SDK Client 和成对 `InMemoryTransport`，从协议表面验证 `tools/list`、`tools/call`、Roots 和错误结果。

## 3. Server 启动入口

入口文件是 [`index.ts`](../servers/official-servers/src/filesystem/index.ts)。启动链为：

```text
npm bin: mcp-server-filesystem
  → dist/index.js
  → isEntryPoint(process.argv[1], import.meta.url)
  → main(process.argv.slice(2), stdin, stdout)
  → resolveAllowedDirectories(args)
  → createServer(allowedDirectories)
  → new StdioServerTransport(stdin, stdout)
  → server.connect(transport)
```

### 3.1 CLI allowed directories

`resolveAllowedDirectories()`：

1. 展开 `~`；
2. 转成绝对路径并规范化；
3. 尝试 `realpath()` 解析 symlink；
4. 同时保留原路径和真实路径，以兼容 `/tmp → /private/tmp` 等情况；
5. 用 `stat()` 过滤不存在、不可访问或非目录参数；
6. 如果用户提供过路径但全部不可用，进程退出 1。

### 3.2 无 CLI 目录时的行为

零参数不会立即退出。Server 会等待支持 Roots 的 Client 在初始化后提供目录：

- Client 支持 Roots：Server 调 `roots/list`，用合法 Roots 替换 CLI allow-list；
- Client 不支持 Roots，且 CLI 也没有目录：Server 记录错误、关闭连接，stdio 入口退出 1；
- Client 支持 Roots 但暂未提供合法目录：连接可保留，所有文件调用因 allow-list 为空而被拒绝。

### 3.3 【版本边界】

当前代码使用：

```text
server.server.oninitialized
  → getClientCapabilities()
  → server.server.listRoots()
```

这是 SDK 1.x 的 initialization-based 流程。它与上一阶段研究的 MCP `2025-11-25` 及更早版本一致；不能直接映射成 `2026-07-28` 每请求自包含模型。

## 4. Tool 注册方式

核心工厂是 [`createServer()`](../servers/official-servers/src/filesystem/server.ts)：

```text
createServer(initialAllowedDirectories)
  → new McpServer({ name: "secure-filesystem-server", version })
  → 创建 per-instance allowedDirectories / rootsGeneration / barrier
  → 包装 server.registerTool()
  → 依次注册 14 个 Tool
  → 注册 roots/list_changed notification handler
  → 设置 oninitialized Roots 加载
  → return server
```

`allowedDirectories` 存在 `createServer()` 的 closure 内，而不是模块全局变量，因此同一进程可以创建多个隔离的 Server instance。

### 4.1 Roots barrier

源码先保存原始 `server.registerTool`，再把它包装成：

```text
收到 tools/call
  → 等待当前 Roots refresh barrier settled
  → 确认等待期间没有更新的 barrier 替换它
  → 执行真实 Tool handler
```

作用是防止以下竞态：Client 已撤销目录，但新的 `roots/list` 尚未返回时，Tool 仍按旧 allow-list 执行。每次 Roots refresh 还带递增 generation；旧响应晚到时会被丢弃，不能覆盖更新的授权状态。

### 4.2 已注册 Tool

| Tool | 类型 | 核心输入 | 实际执行 |
|---|---|---|---|
| `read_file` | 只读、deprecated | `path`, `head?`, `tail?` | `read_text_file` 的兼容别名 |
| `read_text_file` | 只读 | `path`, `head?`, `tail?` | 读完整文本或首/尾 N 行 |
| `read_media_file` | 只读 | `path` | base64 读取图像、音频或普通二进制 |
| `read_multiple_files` | 只读 | `paths[]` | 并行读取；单文件失败不会终止整批 |
| `write_file` | 写入、destructive | `path`, `content` | 新建或原位覆盖文件 |
| `edit_file` | 写入、destructive | `path`, `edits[]`, `dryRun?` | 精确文本编辑并返回 diff |
| `create_directory` | 写入、非 destructive | `path` | 递归创建目录 |
| `list_directory` | 只读 | `path` | 返回 `[FILE]` / `[DIR]` 列表 |
| `list_directory_with_sizes` | 只读 | `path`, `sortBy?` | 带大小和汇总的目录列表 |
| `directory_tree` | 只读 | `path`, `excludePatterns?` | 递归生成 JSON tree |
| `move_file` | 写入、destructive | `source`, `destination` | 移动/重命名，目标存在时拒绝 |
| `search_files` | 只读 | `path`, `pattern`, `excludePatterns?` | allow-list 内递归 glob 搜索 |
| `get_file_info` | 只读 | `path` | 返回大小、时间、类型和权限 |
| `list_allowed_directories` | 只读 | 无 | 返回当前 allow-list |

### 【源码确认事实】

- 14 个 Tool 均在 `server.ts` 中直接调用 `server.registerTool()`；
- `read_file` 虽已 deprecated，仍会出现在 `tools/list`；
- 10 个 Tool 标为 read-only，4 个会修改文件系统；
- Tool annotations 是给 Client/Host 的行为提示，不是权限执行器；
- 真正的目录限制来自每个 handler 调用的 `validatePath()`。

## 5. Tool schema 定义

### 5.1 Zod → JSON Schema

输入 schema 先以 Zod 定义，例如：

```text
ReadTextFileArgsSchema
  path: string
  tail?: number
  head?: number

EditFileArgsSchema
  path: string
  edits: Array<{ oldText: string; newText: string }>
  dryRun: boolean = false
```

`jsonSchema2020(shape)` 用 `z.object(shape)` 创建对象 schema，并在 metadata 上声明：

```text
https://json-schema.org/draft/2020-12/schema
```

源码注释说明 SDK 1.x 内部仍按 Zod draft-07 方式渲染，因此测试额外保证当前 schema 没有 tuple `items`、`additionalItems` 或 `definitions` 等会与 2020-12 含义冲突的关键字。

### 5.2 每个注册项的组成

每次 `registerTool(name, config, handler)` 的 `config` 包含：

- `title`；
- `description`；
- `inputSchema`；
- `outputSchema`；
- `annotations`。

除 `read_media_file` 外，当前 Tool 的结构化输出统一为：

```json
{
  "content": "string"
}
```

同时还返回一个 text content block。`read_media_file` 的输出 schema 是 union：image、audio 或 embedded resource。

### 5.3 注解不是强制策略

写操作的注解包括：

| Tool | readOnly | idempotent | destructive |
|---|---:|---:|---:|
| `create_directory` | false | true | false |
| `write_file` | false | true | true |
| `edit_file` | false | false | true |
| `move_file` | false | false | true |

所有 Tool 都声明 `openWorldHint: false`。这些字段帮助 Host 进行展示、风险分析或确认，但 `server.ts` 不会因为 Host 忽略 annotations 而自动弹出确认窗口。

## 6. Resource 实现

### 6.1 【源码确认事实：没有 Resource endpoint】

对 `src/filesystem` 的 TypeScript 源码搜索没有发现：

```text
registerResource(...)
resources/list
resources/read
```

协议级测试还确认 Server capabilities 恰好是：

```json
{
  "tools": {
    "listChanged": true
  }
}
```

因此这个实现的文件读取能力是 **Tool-first**，不是 Resource-first。

### 6.2 三个容易混淆的对象

| 对象 | 是 MCP Resource 吗 | 作用 |
|---|---|---|
| Client Roots | 否 | Client 告诉 Server 哪些目录可作为文件操作边界 |
| `read_media_file` 的 embedded `resource` content block | 否，不可通过 `resources/list` 发现 | 把二进制 blob、URI 和 MIME 作为一次 Tool result 返回 |
| `registerResource` 注册的 URI | 是 | 应能通过 Resource discovery/read 访问；本 Server 没有实现 |

### 【合理推测】

使用 Tool 而非 Resource 的好处是写入、移动、搜索和读取都能共用一套参数校验与错误模型；代价是 Client 无法通过 Resource URI 列表、模板或订阅机制浏览文件资源，所有访问都表现为模型可调用的 Tool。

### 【未验证】

没有验证未来 SDK v2 migration 是否会为 Filesystem Server 增加 Resource；当前固定 commit 中没有这种实现。

## 7. `tools/list → tools/call → result` 完整流程

### 7.1 `tools/list`

根据 [`__tests__/helpers.ts`](../servers/official-servers/src/filesystem/__tests__/helpers.ts) 和 [`server-tools.test.ts`](../servers/official-servers/src/filesystem/__tests__/server-tools.test.ts)：

```text
SDK Client.listTools()
  → JSON-RPC tools/list
  → SDK McpServer 的 tools/list handler
  → 读取 registerTool() 建立的注册表
  → 按注册顺序生成 14 个 Tool definition
  → Zod schema 转成 JSON Schema
  → 返回 name/title/description/inputSchema/outputSchema/annotations
  → Client 获得 Tool list
```

Server 自身没有手写 `tools/list` switch；高层 SDK 根据 `registerTool()` 注册表实现协议方法。

### 7.2 `tools/call`

以 `read_text_file` 为例：

```text
Client.callTool({
  name: "read_text_file",
  arguments: { path, head?, tail? }
})
  → JSON-RPC tools/call
  → SDK 按 name 查找 Tool
  → SDK 按 inputSchema 验证 arguments
  → Filesystem registerTool wrapper 等待 Roots barrier
  → readTextFileHandler(args)
  → validatePath(args.path, allowedDirectories)
      ├─ 展开 ~ / 解析相对路径
      ├─ 校验 allowed-directory 边界
      ├─ realpath 检查 symlink target
      └─ 新路径逐级解析父目录
  → readFileContent / headFile / tailFile
  → handler 返回 content + structuredContent
  → SDK 形成 CallToolResult
  → Client 接收 result
  → Host 决定如何放入 LLM context / Observation
```

### 7.3 错误路径

协议级 tests 固定了以下行为：

- 未知 Tool：`isError: true`，错误码语义为 `-32602 Tool ... not found`；
- schema 不合法：`isError: true`，返回 Input validation error；
- 路径越界、symlink 逃逸、文件不存在或 I/O 失败：handler error 被转换为 Tool error；
- `read_multiple_files` 特例：单个文件失败被写入批量文本结果，整个 Tool result 仍可成功。

### 7.4 Result 不等于 Agent Observation

MCP 只把结果交给 Client。若通过 OpenHands 使用，后续还会经过：

```text
CallToolResult
  → MCPToolExecutor
  → MCPToolObservation
  → ObservationEvent
  → 下一轮 LLM context
```

这部分属于 OpenHands Host/Agent 语义，不是 Filesystem Server 自己完成的。

## 8. 文件访问与权限边界

### 8.1 allow-list 来源

允许目录有两种来源：

1. Server 启动参数；
2. Client Roots。

Client 提供有效 Roots 后会**替换** CLI 目录，而不是合并。Roots 已生效后，如果 Client 再撤销全部 Roots，Server 将 allow-list 清空；旧 Roots 响应因为 generation 检查不能恢复已撤销权限。

### 8.2 `validatePath()` 的保护

[`lib.ts`](../servers/official-servers/src/filesystem/lib.ts)、[`path-validation.ts`](../servers/official-servers/src/filesystem/path-validation.ts) 和测试确认：

- 对 `..` traversal 和仅共享字符串前缀的 sibling 路径进行拒绝；
- 路径必须等于 allowed directory 或处于其目录分隔符边界内；
- 拒绝 NUL byte；
- 处理 Windows drive、UNC、WSL 和 Unix 路径差异；
- 对现有目标做 `realpath()`，拒绝指向 allow-list 外的 symlink；
- 对待创建路径逐级解析现有祖先，避免通过中间 symlink 逃逸；
- 新建文件使用 `wx`，覆盖现有文件时检查 regular file、`O_NOFOLLOW`（POSIX）和 dev/inode，降低 TOCTOU symlink swap 风险；
- `move_file` 在目标存在时拒绝，而不是让 `rename` 静默覆盖。

### 8.3 边界的上限

#### 【源码确认事实】

- allow-list 对允许目录内的 Tool 同时开放读和写，没有按目录分别定义 read-only/write scope；
- Server 内部没有用户确认 UI；
- `readOnlyHint` / `destructiveHint` 是 annotation，不是访问控制；
- stdio Server 默认作为 Client 启动的本地子进程运行；
- 若没有额外 Sandbox，它继承该进程用户的 OS 权限和可用资源；
- 官方 Docker 示例可以通过只读 bind mount 限制写入，但容器化不是 Server 源码自动提供的保证。

#### 【合理推测】

- 把包含 `.env`、SSH key、浏览器 profile 或其他秘密的上级目录放进 Roots，会让只读 Tool 能看到其中内容；
- Host 若无条件暴露 `write_file`、`edit_file`、`move_file`，模型选择错误就可能造成数据损失；
- `read_media_file` 最终把全部 chunks 合并并 base64 编码，大文件可能造成明显内存与上下文压力；当前 handler 未见统一文件大小上限；
- 目录 allow-list 是很重要的纵深防御，但不能替代进程隔离、用户确认、备份和最小挂载。

#### 【未验证】

未运行 symlink race、Windows ACL、网络共享、超大文件、并发写或容器逃逸测试；这里只记录源码设计与仓库测试意图。

## 9. 与 OpenHands Workspace 对比

| 维度 | Filesystem MCP Server | OpenHands Workspace / Runtime |
|---|---|---|
| 文件访问方式 | Agent/Host 经 `tools/call` 调 14 个文件 Tool；Server 进程使用 Node `fs` | Agent 通常用 `FileEditorTool` 在 Runtime 内直接访问挂载路径；Workspace 主要提供 `working_dir` 和远端 API 句柄 |
| 读写表达 | MCP Tool schema + `CallToolResult` | `ActionEvent → FileEditorExecutor → FileEditorObservation → ObservationEvent` |
| 路径范围 | CLI allowed directories 或 Client Roots；每次操作调用 `validatePath()` | `working_dir` 是工作基准；当前 FileEditor 自身不统一强制“必须在 workspace_root 内”，边界更多来自 Runtime mount/用户权限 |
| 用户确认 | Server 没有确认 UI；依赖 Host 阅读 annotations 并执行策略 | 可用 SecurityAnalyzer 和 ConfirmationPolicy，但默认/部署配置决定是否启用 |
| 执行边界 | 默认 stdio 子进程；没有额外配置时与 Host 同一 OS 用户 | 可是 host-local，也可在每 Conversation Docker/Kubernetes Runtime 中运行 |
| Shell 能力 | 无 Shell Tool，只做固定文件操作 | Runtime 同时可承载 Terminal/Shell、FileEditor、Git 等更广能力 |
| 状态 | 主要是 allow-list、Roots generation 和连接生命周期 | Conversation state、EventLog、Workspace、Runtime、terminal session 等共同保存状态 |

### 【人工解释】

Filesystem Server 是一个**窄接口能力服务**：它把文件操作约束成可发现、可验证的 MCP Tool。OpenHands Workspace 是**任务执行环境抽象**：它不仅服务文件操作，还参与 Shell、测试、Git 和会话生命周期。

两者可以组合：OpenHands 作为 Host 消费 Filesystem MCP Tool，并将结果转换成 Observation。但这不会自动让 OpenHands Runtime 更安全；真正边界取决于 Filesystem Server 进程运行在哪里、挂载了什么、Roots 给了什么，以及 OpenHands 是否启用确认策略。

## 10. 与 Agent Reach Skill 对比

| 维度 | Filesystem MCP Server | Agent Reach Skill |
|---|---|---|
| 能力声明 | `tools/list` 返回机器可读 name、JSON Schema、annotations | Markdown frontmatter、正文和 reference 描述何时使用某渠道/命令 |
| 能力发现 | MCP Client 动态请求 Server 注册表 | 宿主 Agent 读取 Skill 文本并匹配意图；Channel/doctor 可补充 backend 状态 |
| 能力执行 | `tools/call` 进入固定 TypeScript handler，再调用 Node `fs` | 多数路径由宿主 Shell 直接调用 `gh`、`curl`、OpenCLI、mcporter 等上游工具 |
| 输入验证 | SDK/Zod schema + handler 路径校验 | 主要依赖命令参数、上游 CLI 和宿主 Agent遵守文字规则 |
| 权限责任 | Host 决定是否调用；Server 强制目录 allow-list；OS/容器限制进程权限 | Skill 提供建议但不是 Sandbox；实际权限来自宿主、Shell、上游工具、账号和 MCP Server |
| 结果契约 | 标准 MCP `CallToolResult`，含 content/structuredContent/isError | 多数是 stdout/stderr 或上游 JSON，没有统一 Action/Observation 模型 |

### 【人工解释】

Skill 更像“给 Agent 的能力使用说明和路由策略”，MCP Server 更像“有机器可读契约的可执行能力端”。Skill 可以指导宿主去调用一个 MCP Server，但 Skill 文本本身不能强制 Tool schema、路径 allow-list 或用户确认。

## 11. 风险与主观建议

### 【主观建议】

如果未来设计最小安全实验，应：

1. 创建全新的临时实验目录，只放无敏感信息的样例文件；
2. 不把 `D:\`、用户目录或项目根目录直接设为 Root；
3. 首次只测试 `list_allowed_directories`、`list_directory` 和 `read_text_file`；
4. 不向模型暴露写入 Tool，或在 Host 侧单独禁用/确认 `write_file`、`edit_file`、`move_file`；
5. 若测试写入，使用一次性目录并保留调用前后文件清单；
6. 运行在低权限进程或只挂载实验目录的容器内；
7. 先确认 Client/Server 使用的协议时代，避免把 SDK 1.x Roots 生命周期与 `2026-07-28` 混用。

本阶段仅做源码研究，不执行该实验。

## 12. 关键源码索引

- [官方 reference servers 说明](../servers/official-servers/README.md)
- [Filesystem README](../servers/official-servers/src/filesystem/README.md)
- [package.json](../servers/official-servers/src/filesystem/package.json)
- [stdio 入口 `index.ts`](../servers/official-servers/src/filesystem/index.ts)
- [Server 与 Tool 注册 `server.ts`](../servers/official-servers/src/filesystem/server.ts)
- [文件操作与路径验证 `lib.ts`](../servers/official-servers/src/filesystem/lib.ts)
- [目录边界判断 `path-validation.ts`](../servers/official-servers/src/filesystem/path-validation.ts)
- [路径规范化 `path-utils.ts`](../servers/official-servers/src/filesystem/path-utils.ts)
- [Roots 解析 `roots-utils.ts`](../servers/official-servers/src/filesystem/roots-utils.ts)
- [协议测试 helper](../servers/official-servers/src/filesystem/__tests__/helpers.ts)
- [Tool 协议测试](../servers/official-servers/src/filesystem/__tests__/server-tools.test.ts)
- [路径安全测试](../servers/official-servers/src/filesystem/__tests__/server-paths.test.ts)
- [Roots 生命周期测试](../servers/official-servers/src/filesystem/__tests__/server-roots.test.ts)
- [OpenHands Workspace/Runtime 研究](../../openhands-study/notes/08-workspace-runtime.md)
- [Agent Reach Skill/Tool flow](../../agent-reach-study/notes/03-skill-tool-flow.md)
- [MCP 架构研究](02-architecture.md)

## 13. 阶段总结

Filesystem MCP Server 展示了一条清晰的真实实现链：

```text
McpServer.registerTool
  → SDK 生成 tools/list 能力描述
  → Client 发 tools/call
  → Zod/JSON Schema 输入验证
  → Roots refresh barrier
  → validatePath + symlink/allow-list 检查
  → Node fs 操作
  → content + structuredContent
  → Client
  → Host/Agent Observation
```

它比“让 Agent 直接执行任意文件命令”更窄、更容易审计，但不是完整 Sandbox：允许目录的选择、写 Tool 是否暴露、用户确认、Server 进程权限和容器挂载仍由 Host 与部署者负责。
