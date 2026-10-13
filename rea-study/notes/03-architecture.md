# REA 架构分析

> 分析对象：`rea-study/rea` 提交 `4773c152bc5f299fa682575bb8d1efea7587c7bc`。  
> 本文描述当前源码中的静态结构与依赖关系，没有通过实际构建或运行时追踪验证全部路径。

## 1. 架构目标

REA 的核心目标不是简单包装某个反编译器，而是把不同目标、不同分析引擎和不同调用入口统一为可追踪的调查流程。

已确认的设计原则：

1. CLI 与 MCP 共用应用层工作流，避免两套行为逐渐分叉。
2. 领域语义和公开契约位于内层，provider 协议位于适配层。
3. 每次结果保留 provider、目标、参数、局限和位置等 Evidence 来源。
4. 深度 provider 选择具有确定性；选定后失败不会静默换引擎。
5. 子进程、临时目录、取消与清理都有明确所有者。
6. 对未知身份、未知覆盖和未完成清理保留“未知”，而不是假设安全或完整。

官方架构图见 [`docs/architecture.mermaid`](../rea/docs/architecture.mermaid)。

## 2. 总体数据流

```text
                     ┌──────────────────────┐
                     │ scripts/rea.mjs      │
                     │ 可执行分流入口       │
                     └──────────┬───────────┘
                                │
                 ┌──────────────┴──────────────┐
                 ↓                             ↓
       ┌─────────────────┐           ┌─────────────────┐
       │ CLI adapter     │           │ MCP adapter     │
       │ src/cli.ts      │           │ src/main.ts     │
       │ src/cli/        │           │ src/server/     │
       └────────┬────────┘           └────────┬────────┘
                └──────────────┬──────────────┘
                               ↓
                  ┌────────────────────────┐
                  │ application workflows  │
                  │ session / investigation│
                  └────────────┬───────────┘
                               ↓
                  ┌────────────────────────┐
                  │ composition            │
                  │ provider factories     │
                  └────────────┬───────────┘
                               ↓
       ┌───────────────────────┼────────────────────────┐
       ↓                       ↓                        ↓
  Hopper/Ghidra/IDA      JS/.NET/browser        Android/firmware/...
       │                       │                        │
       └───────────────────────┼────────────────────────┘
                               ↓
                  normalized result + Evidence
                               ↓
                         CLI 或 MCP 调用方
```

依赖方向的重点是：入口适配器依赖应用层，应用层通过端口使用 provider；领域层不应反向依赖 CLI、MCP 或具体分析引擎。

## 3. 分层说明

| 层 | 主要目录 | 职责 |
| --- | --- | --- |
| 可执行边界 | `scripts/rea.mjs` | 判断 CLI/MCP 模式，检查构建产物，装载运行时 |
| CLI 适配 | `src/cli.ts`、`src/cli/` | 命令、参数、输出和退出状态 |
| MCP 适配 | `src/main.ts`、`src/main/`、`src/server/` | stdio 生命周期、工具注册、请求翻译和响应预算 |
| 生产装配 | `src/composition/` | 创建 provider、session 和应用服务，不在导入时启动引擎 |
| 应用层 | `src/application/` | 跨入口共享的分析工作流、会话、调查和 Evidence 记录 |
| 契约层 | `src/contracts/` | 对外工具输入输出、schema、effect 和错误契约 |
| 领域层 | `src/domain/` | 纯语义、目标身份、Evidence、比较、未知项与错误代数 |
| provider 适配 | `src/hopper/`、`src/ghidra/` 等 | 将具体引擎或格式转换为统一操作与结果 |
| 进程基础设施 | `src/process/`、`src/windows/`、`native/` | 所有权、隔离、超时、取消、权限和清理 |
| 外部桥 | `bridge/` | Python、Java、Swift 等引擎内或跨进程桥接 |

## 4. 启动边界

### 4.1 可执行分流

[`scripts/rea.mjs`](../rea/scripts/rea.mjs) 是 npm 包声明的 `rea` 与 `rea-agents` 可执行文件。它在导入 CLI 框架前先识别 `mcp`/`--mcp`，避免 CLI 注册逻辑干扰生产 MCP Server。

它还验证 `dist/` 中所需文件是否存在。源码未构建时会失败关闭，而不是尝试从 TypeScript 源码临时运行。

### 4.2 CLI 生命周期

[`src/cli.ts`](../rea/src/cli.ts) 创建 CLI 并注册各能力命令。  
[`src/application/DirectAnalysis.ts`](../rea/src/application/DirectAnalysis.ts) 对一次命令创建 session、打开目标、执行操作并清理资源。

CLI 的特点：

- 一次调用是独立进程；
- 默认不跨命令保留活动目标；
- 需要跨命令复用时，将 Evidence 或 snapshot 保存为文件；
- 退出码与结构化错误共同表示结果。

### 4.3 MCP 生命周期

[`src/main.ts`](../rea/src/main.ts) 读取环境配置，创建长驻 `BinarySession`，启动 stdio 传输，并注册 SIGINT、SIGTERM、stdin 结束等关闭路径。

[`src/server/createServer.ts`](../rea/src/server/createServer.ts) 负责：

- 创建 MCP Server；
- 注册 session、原生、制品、浏览器、Android、Wasm 等工具；
- 将工具结果记录为 Evidence；
- 控制响应大小和紧凑 schema；
- 关闭可选 provider 和临时资源。

MCP 的特点：

- 同一连接可保留目标、Evidence 和分析状态；
- 可通过 Evidence ID 分页查看大型结果；
- 关闭连接时需要统一释放多个 provider。

## 5. Session 与 provider 路由

### 5.1 Provider 抽象

[`src/application/AnalysisProvider.ts`](../rea/src/application/AnalysisProvider.ts) 定义了统一 provider 接口：

- `identity()`：provider 身份与版本；
- `capabilities()`：操作、可用性、副作用和缓存策略；
- `resolveAnalysisProfile()`：在启动 provider 前解析分析配置；
- `createClient()`：为一个确定目标创建 client；
- `execute()`：执行规范化操作；
- `close()`：释放该 client 拥有的资源。

Capability 的 effect 会区分是否修改制品、启动进程、显示 UI、访问网络、写文件、改变权限或需要 root。这些字段用于表达边界，不应被工具名称替代。

### 5.2 Provider 选择

[`src/composition/binary.ts`](../rea/src/composition/binary.ts) 创建 Hopper、Ghidra 和 IDA 深度 provider，并添加延迟加载的辅助 provider。  
[`AnalysisProviderRegistry.ts`](../rea/src/application/binary/AnalysisProviderRegistry.ts) 评估候选 provider。  
[`SessionProviderRouter.ts`](../rea/src/application/binary/SessionProviderRouter.ts) 将目标与合适的能力组合绑定。

选择依据包括：

- 调用方是否显式指定 provider；
- provider 在当前主机是否可用；
- provider 是否支持目标格式、架构和角色；
- 目标是否应由辅助静态 provider 处理；
- profile 是否与缓存或 snapshot 一致。

合理推测：这种设计优先保证分析语义可重复，而不是追求“无论如何都返回点结果”。因此歧义或 provider 不可用时，系统倾向于返回可诊断错误，要求调用方明确选择或修复环境。

### 5.3 BinarySession

[`BinarySession.ts`](../rea/src/application/binary/BinarySession.ts) 是原生分析主状态机：

- 单个 session 同时只拥有一个活动目标；
- 目标切换被串行化；
- 切换前等待已准入调用完成；
- 关闭失败的资源会被保留，等待重试，而不是假装清理完成；
- 新目标启动失败时，尽可能恢复之前的绑定；
- 活动操作、运行身份和 provider 健康状态可以被查询；
- 支持 Evidence/snapshot 记录与复用。

这类复杂性来自真实外部进程和分析数据库的生命周期，而不是单纯的数据转换。

## 6. Evidence 架构

[`src/domain/evidence.ts`](../rea/src/domain/evidence.ts) 定义 Evidence。一个典型记录包含：

| 字段 | 含义 |
| --- | --- |
| `evidence_id` | 基于语义内容计算的稳定标识 |
| `subject` | 目标名称、SHA-256、格式、架构和本地路径 |
| `provider` | 产生观察结果的 provider 身份 |
| `analysis_profile` | 与结果绑定的分析配置 |
| `operation` / `parameters` | 执行的操作及输入 |
| `raw_result` | provider 原始表示；没有独立原始表示时为 `null` |
| `normalized_result` | 对外使用的规范化结果 |
| `confidence` | `observed`、`derived` 或 `inferred` |
| `authority` | 制品、重放、历史来源、外部服务或分析者推断 |
| `limitations` | 已知局限与未覆盖范围 |
| `locations` | 地址、地址范围、制品路径或文件偏移 |
| `evidence_links` | 与其他 Evidence 的关联 |

Evidence 的作用不是声称结果绝对正确，而是让调用方知道“谁、对什么、用什么配置、执行了什么、看到什么、还有哪些限制”。

## 7. Provider 家族

### 深度原生分析

- `src/hopper/`：Hopper 启动、socket 协议和 Python bridge。
- `src/ghidra/`：headless Ghidra、临时工程、Java bridge、导入与分析生命周期。
- `src/ida/`：将 `ida-pro-mcp` 适配为 REA provider。

### 静态制品分析

- `src/dotnet/`：PE/CLI 元数据和 CIL。
- `src/javascript/`、`src/artifacts/javascript/`：JavaScript、source map、ASAR 和恢复。
- `src/wasm/`、`src/evm/`、`src/sqlite/`、`src/go/`：特定格式分析。

### 应用与运行时观察

- `src/browser/`：CDP、Playwright、网络与页面观察。
- `src/inspector/`：被动 V8 Inspector 发现与捕获。
- `src/android/`、`src/adb/`、`src/apktool/`、`src/jeb/`：Android 静态与设备工作流。
- `src/firmware/`、`src/captures/`、`src/signals/`：固件、抓包和信号制品。

这些模块并非拥有相同副作用。静态读取、启动辅助进程、连接现有 GUI、运行目标和注入 instrumentation 必须分别看待。

## 8. 进程与资源所有权

[`src/process/`](../rea/src/process/) 处理 provider 的公共运行基础：

- 私有运行根目录；
- 进程启动身份与 lineage；
- deadline、取消和待处理请求；
- 有界文件读取和诊断输出；
- 清理失败后的所有权保留；
- Linux 资源限制与 Windows authority。

Windows 的 [`native/windows/`](../rea/native/windows/) 通过 Node-API 实现固定 NTFS 路径准入、受保护 DACL 和 Job Object 原子分配等能力。

关键原则：PID 与可执行路径不足以在进程退出或 PID 复用后证明所有权。只有仍可验证的身份才能授权清理；身份不确定时保留资源比误删更安全。

## 9. JavaScript 静态分析路径示例

一个目录或 ASAR 的静态分析大致经过：

```text
CLI/MCP 输入
  → JavaScriptApplicationService
  → artifact inventory / ASAR reader
  → 受控 JavaScript analysis worker
  → AST、imports、entrypoints、Electron boundaries
  → application graph / semantic graph
  → Evidence sealing
  → 完整结果或保留后的 summary/page
```

该路径读取调用方指定的本地文件，不执行应用，也不需要 Hopper、Ghidra、浏览器或 Electron 进程。静态 import 和入口关系只证明代码结构，不能证明运行时一定执行。

主要参考：

- [`docs/javascript-artifact-reconstruction.md`](../rea/docs/javascript-artifact-reconstruction.md)
- [`src/application/javascript/JavaScriptApplicationService.ts`](../rea/src/application/javascript/JavaScriptApplicationService.ts)
- [`src/domain/javascript/javascriptApplicationAnalysis.ts`](../rea/src/domain/javascript/javascriptApplicationAnalysis.ts)

## 10. 扩展架构时的检查清单

以下来自项目自身约束，可用于阅读代码或评估设计：

1. 新能力回答的分析问题是什么？
2. 是否能复用已有 contract，而不是增加近似重复工具？
3. provider 特有协议是否被限制在适配层？
4. 是否保留调用方输入、目标身份、未知项和 Evidence 来源？
5. 是否明确启动、网络、文件写入、UI、权限和 mutation 副作用？
6. 取消、超时、并发和清理失败后谁继续拥有资源？
7. 测试是纯模拟、生产边界，还是经过真实 provider 验证？
8. 大型结果如何控制 token、响应大小、分析时间和内存？

## 11. 已确认、推测与未验证

### 已确认

- CLI 与 MCP 共享 application/composition 层。
- 二进制 session 使用单活动目标和确定性 provider 路由。
- Evidence 显式保存来源、限制与置信度。
- 外部进程与临时资源有专门的所有权基础设施。

### 合理推测

- REA 的主要工程难点是多 provider 的语义一致性与生命周期治理，而不是单个解析算法。
- 其架构更适合增加“带证据的受控工作流”，不适合暴露无限制的原始执行接口。

### 本次未验证

- 构建后实际模块拆包与冷启动性能；
- MCP 客户端真实调用序列；
- 各 provider 的跨平台运行行为；
- 真实目标下的取消、恢复和资源清理结果。

## 12. 参考资料

- [项目概览](01-overview.md)
- [安装说明](02-install.md)
- [官方架构图](../rea/docs/architecture.mermaid)
- [MCP 契约](../rea/docs/mcp-contracts.md)
- [CLI 与 Evidence](../rea/docs/cli.md)
- [仓库开发规范](../rea/AGENTS.md)
