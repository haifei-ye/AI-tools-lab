# REA 项目概览

> 分析对象：`rea-study/rea` submodule，提交 `4773c152bc5f299fa682575bb8d1efea7587c7bc`。  
> `package.json` 中的版本为 `6.4.0`；当前提交的 `git describe` 为 `rea-agents-6.4.0-372-g4773c152b`，因此该源码快照位于 `6.4.0` 标签之后，不能把它与 npm 上发布的 `6.4.0` 包视为完全相同的代码。  
> 本文基于仓库源码和仓库内官方文档进行静态分析；本次未安装依赖、未构建、未运行测试，也未实测 Hopper、Ghidra、IDA 等外部分析引擎。

## 1. 项目用途总结

### 已确认事实

REA 全称 **Reverse Engineer Anything**。它是一个本地运行的逆向工程工具层，向终端用户提供 CLI，同时向 AI 编程智能体提供 MCP Server。CLI 和 MCP 共用同一套应用工作流与分析 provider，使智能体或用户可以用统一接口分析：

- 原生二进制文件；
- JavaScript、Electron 应用和 source map；
- 网站、浏览器运行时和网络活动；
- .NET 程序集；
- Android APK、设备与资源；
- 固件、Wasm、EVM 字节码、SQLite、抓包和逻辑信号等制品。

它本身不是一个反编译器替代品。对于深度原生分析，REA 会连接 Hopper、Ghidra 或 IDA 等外部引擎；对于 JavaScript、.NET 和部分文件格式，它也包含可直接运行的静态分析能力。

项目的一个核心设计目标是让分析结论附带 **Evidence**：记录目标身份、provider、分析配置、操作参数、原始或规范化结果、置信度、局限、位置及关联证据。项目还特别强调：

- 本地分析和明确的目标授权；
- 区分观察、推导、推测和未知项；
- provider 选择、进程所有权、取消与资源清理；
- 对运行目标、注入、修改和外部副作用采取失败关闭策略；
- CLI 与 MCP 之间保持相同的分析语义。

主要依据：[`README_zh.md`](../rea/README_zh.md)、[`AGENTS.md`](../rea/AGENTS.md)、[`docs/architecture.mermaid`](../rea/docs/architecture.mermaid)、[`src/domain/evidence.ts`](../rea/src/domain/evidence.ts)。

### 合理推测

从目录规模、provider 数量、契约与测试体系看，REA 更像“逆向分析编排平台”而不是单一功能工具：它把目标识别、引擎选择、分析调用、证据记录和资源治理统一在一个边界内。这是对架构的归纳，不是项目官方定义的新产品类别。

### 风险边界

REA 用于合法研究、教育、互操作性、软件保存，以及分析用户拥有或获准检查的软件。某些工作流可能启动目标程序、连接运行时或调用商业工具；“本地运行”不等于“没有副作用”，也不自动证明目标分析获得授权。详见 [`DISCLAIMER.md`](../rea/DISCLAIMER.md) 和 [`CONTRIBUTING.md`](../rea/CONTRIBUTING.md)。

## 2. 技术栈

| 层面 | 已确认技术 | 用途 |
| --- | --- | --- |
| 主运行时 | Node.js、TypeScript、ESM | CLI、MCP Server、应用服务、领域模型和大多数 provider 适配器 |
| CLI | `incur` | 定义命令、参数以及 MCP 注册入口 |
| MCP | `@modelcontextprotocol/server`、`@modelcontextprotocol/client` | 通过 stdio 暴露工具；连接部分外部 MCP provider |
| 数据契约 | Zod、AJV、JSON Schema | 输入输出校验、配置解析、MCP 工具契约和错误契约 |
| 日志与进程 | Pino、`cross-spawn`、`node-pty`、WebSocket | 结构化日志、子进程监管、PTY 和桥接通信 |
| JS/Electron 分析 | Babel parser/types、Electron ASAR、trace-mapping、parse5 | AST、打包产物、source map、HTML 和 Electron 边界分析 |
| 浏览器分析 | Playwright Core、Chrome DevTools Protocol | 页面、脚本、网络、截图与运行时观察 |
| 原生分析桥 | Python、Java、Swift、C/C++ Node-API | 对接 Hopper、Ghidra、LLDB、mitmproxy，以及 Windows Job Object/文件系统权限边界 |
| 构建 | TypeScript 编译器、Rolldown、Turborepo | 类型编译、CLI/MCP 打包和缓存任务编排 |
| 测试与质量 | Vitest、fast-check、OXLint、Oxfmt、Knip、JSCPD | 单元/边界/验收测试、静态检查、格式化、未使用代码与重复代码检查 |
| 文档 | Markdown、Mermaid、VitePress | 架构、安装、契约、指南和网站文档 |
| 包管理 | npm，锁文件为 `package-lock.json` | 可复现依赖安装与 npm 发布 |

源码采用严格 TypeScript 配置，包括 `strict`、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 和 `NodeNext` 模块解析，目标为 ES2023。具体版本与依赖见 [`package.json`](../rea/package.json) 和 [`tsconfig.json`](../rea/tsconfig.json)。

## 3. 文件结构说明

```text
rea/
├─ scripts/rea.mjs          # npm 可执行入口；在 CLI 与 MCP 模式之间分流
├─ src/
│  ├─ cli.ts, cli/          # 一次性 CLI 适配器与各类命令注册
│  ├─ main.ts, main/        # 长驻 MCP 进程的启动、传输与关闭
│  ├─ server/               # MCP 工具注册、请求翻译、结果交付
│  ├─ composition/          # 生产依赖装配；创建 session、provider 和服务
│  ├─ application/          # CLI/MCP 共用的应用工作流与会话管理
│  ├─ contracts/            # 对调用方公开的工具输入、输出和错误契约
│  ├─ domain/               # 无副作用的领域语义、Evidence、比较和错误模型
│  ├─ process/              # 子进程所有权、超时、取消、隔离与清理
│  ├─ config/               # 环境变量解析与运行配置
│  ├─ hopper/, ghidra/, ida/# 深度原生分析 provider
│  ├─ browser/, javascript/ # 浏览器、Electron、JS、source map 与恢复流程
│  ├─ dotnet/, android/     # .NET 与 Android 分析
│  └─ ...                   # Wasm、EVM、固件、ADB、SQLite、Go 等能力
├─ bridge/                  # Python/Java/Swift 等外部引擎桥接代码
├─ native/                  # Windows Node-API 原生权限与进程控制组件
├─ tests/                   # 边界、集成、验收、契约及跨进程测试
├─ docs/                    # 安装、CLI、MCP、provider 和架构文档
├─ website/                 # rea.tools 网站实现与静态资源
├─ .agents/skills/          # REA 面向智能体的源 Skill
├─ scripts/                 # 构建、生成、验证、发布和测试辅助脚本
├─ experiments/             # 独立实验与效率评估
├─ third_party/, licenses/  # 第三方组件说明和许可证
├─ package.json             # 包元数据、依赖和完整任务入口
└─ turbo.json               # 构建、检查与生成任务图
```

补充说明：

- `dist/` 是构建输出，不是主要源码目录。
- `skills/`、部分产品目录和验证清单是生成产物；开发时应修改 `.agents/skills/reverse-engineer-anything/` 等源文件，而不是直接修改生成结果。
- `bridge/` 与 `native/` 不是独立产品，它们服务于 TypeScript 主运行时与外部分析引擎之间的安全边界。

## 4. 核心模块分析

### 4.1 启动与双入口

[`scripts/rea.mjs`](../rea/scripts/rea.mjs) 是发布包的可执行入口：

1. 判断参数是 MCP 模式还是一次性 CLI 模式；
2. 检查已编译运行时是否存在；
3. MCP 模式载入 `dist/mcp/main.js`；
4. CLI 模式载入 `dist/cli-runtime/cli.js`；
5. 将结构化结果写入标准输出，并把配置或启动错误转换为稳定的退出行为。

这意味着直接检出源码后，如果尚未构建 `dist/`，入口会拒绝运行并提示先安装依赖和构建。

### 4.2 CLI 适配器

[`src/cli.ts`](../rea/src/cli.ts) 使用 `incur` 创建 `rea` 命令，并注册 setup、原生分析、制品、.NET、Android、浏览器、Electron、Evidence、进程捕获等命令。

CLI 采用“一次调用、一次会话”的方式：[`src/application/DirectAnalysis.ts`](../rea/src/application/DirectAnalysis.ts) 打开目标、执行一个工作流，并在结束时释放 provider 资源。它与 MCP 复用同一 application/composition 层，而不是重新实现分析逻辑。

### 4.3 MCP Server

[`src/main.ts`](../rea/src/main.ts) 负责读取配置、创建 `BinarySession`、启动 stdio MCP 传输并安装幂等关闭处理。  
[`src/server/createServer.ts`](../rea/src/server/createServer.ts) 将会话、Evidence 记录器和各类分析服务注册为 MCP 工具，并统一处理工具可用性、响应预算、取消以及 provider 清理。

### 4.4 Composition 与二进制会话

[`src/composition/`](../rea/src/composition/) 是生产装配层。以 [`src/composition/binary.ts`](../rea/src/composition/binary.ts) 为例，它创建 Hopper、Ghidra、IDA provider，并加入 .NET 等辅助 provider。

[`src/application/binary/BinarySession.ts`](../rea/src/application/binary/BinarySession.ts) 是核心状态对象：

- 一个会话只绑定一个活动目标；
- 切换目标时先排空旧请求，再关闭旧 provider；
- provider 启动失败时尝试恢复先前目标；
- 记录活动调用、运行身份、清理失败和可用性变化；
- 支持分析快照与 Evidence 的导入、导出和复用。

[`AnalysisProviderRegistry.ts`](../rea/src/application/binary/AnalysisProviderRegistry.ts) 和 [`SessionProviderRouter.ts`](../rea/src/application/binary/SessionProviderRouter.ts) 根据目标格式、主机能力、显式选择和 provider 可用性决定路由。项目明确避免在已经选定的深度 provider 失败后静默切换到另一个 provider，因为那会改变分析语义和证据来源。

### 4.5 Domain、Contracts 与 Evidence

[`src/domain/`](../rea/src/domain/) 保存无副作用的核心语义，例如目标身份、摘要、Evidence、比较、未知项和错误投影。  
[`src/contracts/`](../rea/src/contracts/) 定义 CLI/MCP 对外工具的输入输出。  
[`src/domain/result.ts`](../rea/src/domain/result.ts) 使用显式 `Result<T, E>` 表示预期失败，而不是把所有错误都交给异常。

[`src/domain/evidence.ts`](../rea/src/domain/evidence.ts) 定义 Evidence 记录。其重要字段包括：

- 被分析目标及 SHA-256；
- provider 与分析 profile；
- 操作、参数、规范化结果和可选原始结果；
- `observed`、`derived`、`inferred` 置信度；
- 局限、覆盖范围、地址或文件位置；
- 其他 Evidence 的关联标识。

这是 REA 区别于简单“调用反编译器并返回文本”的关键设计。

### 4.6 Provider 与桥接层

主要深度原生 provider：

- [`src/hopper/`](../rea/src/hopper/)：启动 Hopper，并通过 Python bridge 通信；
- [`src/ghidra/`](../rea/src/ghidra/)：无界面 Ghidra、临时工程、Java bridge 与受控生命周期；
- [`src/ida/`](../rea/src/ida/)：适配外部 `ida-pro-mcp`，支持 GUI 或受控 headless 数据库；
- [`src/dotnet/`](../rea/src/dotnet/)：静态读取 PE/CLI 元数据与 IL；
- [`src/browser/`](../rea/src/browser/)：CDP/Playwright 页面和 Electron 观察；
- [`src/javascript/`](../rea/src/javascript/) 与 [`src/application/javascript/`](../rea/src/application/javascript/)：AST、模块图、source map、运行时关联和代码恢复；
- Android、固件、Wasm、EVM、ADB、SQLite、抓包等目录：提供各自的格式或外部工具适配。

[`src/process/`](../rea/src/process/) 和 [`native/windows/`](../rea/native/windows/) 是横切基础设施，负责私有运行目录、子进程身份、超时、内存/资源边界、Windows Job Object、取消和失败后的资源保留。它们不是业务附属代码，而是 provider 安全性与可靠性的基础。

### 4.7 一次分析的主路径

```text
scripts/rea.mjs
├─ CLI → src/cli.ts → application workflow ┐
└─ MCP → src/main.ts → src/server/ ─────────┤
                                             ↓
                                  composition / BinarySession
                                             ↓
                                    provider / external bridge
                                             ↓
                                  normalized result + Evidence
                                             ↓
                                      CLI 或 MCP 调用方
```

## 5. 安装运行要求

### 5.1 普通用户使用发布包

基础要求：

- Node.js `22.x` 且至少 `22.19`，或 `24.x` 且至少 `24.11`，或 `26+`；
- npm；Node 23、25 和预发布版本不受支持；
- 网络连接，用于首次通过 npm 获取包；
- 对准备分析的目标具有合法权限。

官方引导入口：

```bash
npx rea-agents setup
```

设置程序会先展示计划并要求确认，然后才修改所选智能体的 MCP 配置、安装匹配的 Skill，或在支持的平台上安装 Hopper。完成后需要重启被配置的智能体。

不依赖原生分析引擎的 JavaScript/Electron 静态分析示例：

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

常用诊断：

```bash
rea doctor --json
rea doctor --provider ghidra --json
```

### 5.2 从当前源码构建

仓库为开发环境固定了：

- `.nvmrc`：Node.js `24.18.0`；
- `package.json#packageManager`：npm `11.16.0`。

官方开发步骤：

```bash
nvm use
npm ci
npm run check:fast
npm run build:cached
```

- `npm ci` 安装锁定依赖并准备 Husky hook，但不构建项目；
- `npm run build:cached` 编译运行时并生成打包后的 Skill；
- 构建后可通过 `node scripts/rea.mjs --help` 检查 CLI，通过 `node scripts/rea.mjs mcp` 启动 stdio MCP Server；
- 修改源码时优先使用 `npm run test:focused -- <测试路径>` 和 `npm run check:fast`，完整本地门禁成本更高。

以上命令是仓库文档给出的流程，本次分析没有实际执行。

### 5.3 外部工具按任务选择

并非所有任务都需要安装全部工具：

- 原生二进制深度分析：Hopper、Ghidra 或 IDA 三者之一；
- 网站分析：Chrome 系浏览器；
- Android APK 深度分析：完整 JDK 与 headless JADX；
- Android 设备：调用方提供 `adb`；
- 固件：Linux 上的 Binwalk 或 Unblob；
- 抓包：Linux 上的 TShark 4.x 与 `prlimit`；
- 其他 provider 还有各自依赖，必须按具体任务查看对应文档。

Windows 相关的已确认限制：

- Hopper 安装在 Windows 上不可用；
- Ghidra 支持属于实验性 Windows x64 P0 边界；
- 该边界要求 Windows 10+ x64、固定本地 NTFS 卷、Ghidra 12.1.x，以及符合 Ghidra 要求的 64 位完整 JDK；当前 Ghidra 12.1 需要 JDK 21+；
- Windows P0 主要接纳 x86/x86-64 PE 应用与 DLL，并保持只读；不能据此推断与 Linux/macOS 的完整功能等价。

详细要求见 [`docs/installation.md`](../rea/docs/installation.md) 和 [`docs/windows-ghidra-p0.md`](../rea/docs/windows-ghidra-p0.md)。

### 5.4 隐藏成本与注意事项

- `setup` 可能修改智能体配置；应逐项审阅计划和目标路径。
- 商业工具的许可证、试用限制和输出分享限制仍然适用，REA 不提供许可证。
- 某些运行时观察会启动或连接目标进程，不应把静态分析的安全假设套用到运行时分析。
- `main` 分支文档可能描述尚未进入 npm `@latest` 的功能；应以实际安装版本的工具目录和 schema 为准。
- 大型二进制、Ghidra JVM、浏览器和多进程 provider 可能产生明显的磁盘、内存和时间成本。

## 6. 新手学习路线

以下属于**主观建议**，目标是先理解产品闭环，再逐步进入复杂 provider。

### 阶段 0：先建立边界意识

阅读：

1. [`README_zh.md`](../rea/README_zh.md)
2. [`DISCLAIMER.md`](../rea/DISCLAIMER.md)
3. [`CONTRIBUTING.md`](../rea/CONTRIBUTING.md) 的 contribution scope

学习目标：知道哪些任务是静态读取，哪些会启动进程、连接运行时或修改分析数据库元数据；只对自有或已授权目标操作。

### 阶段 1：先作为用户体验最短闭环

1. 阅读快速开始和 [`docs/installation.md`](../rea/docs/installation.md)。
2. 先运行 `rea doctor --json` 理解 readiness 报告。
3. 选择一个自己创建的、很小的 JavaScript 示例目录，尝试 `analyze-javascript-application`。
4. 查看 JSON 输出中的模块、引用、Evidence 和 limitations。

暂时不要从 Hopper/Ghidra 开始；静态 JavaScript 路径的外部依赖和许可成本最低。

### 阶段 2：理解入口与分层

按顺序阅读：

1. [`scripts/rea.mjs`](../rea/scripts/rea.mjs)
2. [`src/cli.ts`](../rea/src/cli.ts)
3. [`src/main.ts`](../rea/src/main.ts)
4. [`src/server/createServer.ts`](../rea/src/server/createServer.ts)
5. [`docs/architecture.mermaid`](../rea/docs/architecture.mermaid)

学习目标：能画出 CLI 与 MCP 如何汇合到共享 application 层，并解释为什么 provider 不应直接依赖 CLI 或 MCP。

### 阶段 3：掌握核心领域模型

重点阅读：

1. [`src/domain/result.ts`](../rea/src/domain/result.ts)
2. [`src/domain/evidence.ts`](../rea/src/domain/evidence.ts)
3. [`src/application/AnalysisProvider.ts`](../rea/src/application/AnalysisProvider.ts)
4. [`src/application/binary/BinarySession.ts`](../rea/src/application/binary/BinarySession.ts)
5. [`src/application/binary/AnalysisProviderRegistry.ts`](../rea/src/application/binary/AnalysisProviderRegistry.ts)

学习目标：理解 `Result`、provider capability、单目标会话、分析 profile、Evidence 和未知项如何共同防止“把推测当事实”。

### 阶段 4：沿一个简单能力纵向追踪

建议从 JavaScript 静态分析中选一个命令，沿以下方向追踪：

```text
CLI/MCP 注册 → application service → artifact reader/worker
→ domain normalization → Evidence → 输出契约
```

不要同时阅读所有 provider。先能完整解释一个请求如何进入、如何验证、如何产生证据、如何清理资源，再扩展到浏览器或 .NET。

### 阶段 5：建立开发与测试习惯

1. 使用 `.nvmrc` 和锁定 npm 版本准备环境。
2. 执行 `npm ci`、`npm run check:fast`、`npm run build:cached`。
3. 阅读与所选模块相邻的 `*.test.ts`。
4. 只运行聚焦测试，再理解 boundary、acceptance 和 real-provider 测试的区别。

学习目标：知道单元测试通过不等于真实 provider 已验证；能在结论中明确写出未覆盖的平台和外部工具。

### 阶段 6：最后学习原生 provider

建议顺序：

1. [`src/composition/binary.ts`](../rea/src/composition/binary.ts)：provider 如何装配；
2. [`src/ghidra/GhidraProvider.ts`](../rea/src/ghidra/GhidraProvider.ts) 或 [`src/hopper/HopperProvider.ts`](../rea/src/hopper/HopperProvider.ts)：能力与可用性检查；
3. 对应 `bridge/`：跨语言协议；
4. [`src/process/`](../rea/src/process/)：所有权、取消、超时和清理；
5. 对应的 `docs/` 安装与真实 provider 验证指南。

学习目标：理解“调用外部引擎”只是表层，真正困难的是目标身份、进程所有权、并发、取消、结果来源和失败后的清理。

## 本次未验证信息

- 当前机器是否满足 Node/npm 的源码开发版本要求；
- 依赖能否在当前机器完整安装与构建；
- 当前 npm `@latest` 的实际版本和内容；
- Hopper、Ghidra、IDA、JADX、浏览器等 provider 在当前机器的可用性；
- 全部测试是否通过。

这些项目没有因为“源码存在”而被判定为可用。需要时应使用相应的 `doctor`、构建命令和真实 provider 验证流程逐项确认。
