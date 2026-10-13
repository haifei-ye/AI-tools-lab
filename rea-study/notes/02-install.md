# REA 安装与运行准备

> 适用源码快照：`rea-study/rea` 提交 `4773c152bc5f299fa682575bb8d1efea7587c7bc`。  
> 本文是安装说明，不代表当前电脑已完成安装或 provider 实测。`main` 分支与 npm 发布包可能存在差异，实际能力应以正在运行的版本、工具目录和诊断结果为准。

## 1. 先选择使用方式

REA 有两种常见使用方式，目标不同，不应混用。

### 方式 A：使用 npm 发布包

适合：先体验 REA、连接 Codex 等智能体、执行普通分析任务。

优点：步骤少，不需要在源码目录构建。  
代价：首次运行需要联网下载 npm 包；`@latest` 可能与当前 submodule 源码不同。

官方入口：

```powershell
npx rea-agents setup
```

`setup` 会先展示计划，并在修改智能体配置或安装 Hopper 前要求确认。npm 的包下载确认与 REA 自己的配置变更确认是两件事，都需要认真阅读。

### 方式 B：从当前源码构建

适合：学习源码、调试、开发或验证当前 submodule 中尚未发布的能力。

优点：代码与本地分析对象一致。  
代价：需要安装完整开发依赖并构建，耗时和磁盘占用更高。

源码目录：

```text
D:\AI-tools-lab\rea-study\rea
```

## 2. 基础运行要求

### 已确认要求

| 项目 | 要求 |
| --- | --- |
| Node.js | `22.x >= 22.19`、`24.x >= 24.11` 或 `26+` |
| 不支持的 Node.js | 23、25 和预发布版本 |
| 包管理器 | npm；源码开发固定为 npm `11.16.0` |
| 源码开发 Node.js | `.nvmrc` 固定为 `24.18.0` |
| 操作权限 | 只分析自己拥有或明确获准检查的目标 |
| 网络 | 首次通过 npm 获取包时需要；本地静态分析本身不等于上传目标 |

查看本机版本：

```powershell
node --version
npm --version
```

版本号存在并不等于完整环境已经就绪。还需要让 REA 对具体任务做范围化诊断。

## 3. 使用发布包

### 3.1 引导式设置

```powershell
npx rea-agents setup
```

典型流程：

1. 选择要连接的智能体；
2. 查看将要修改的配置路径；
3. 决定是否安装配套 Skill；
4. 如任务需要，再选择 Hopper 或保存已有 Ghidra 路径；
5. 审阅最终计划并确认；
6. 完成后重启被配置的智能体。

只预览计划、不写入配置：

```powershell
npx rea-agents setup --dry-run
```

注意：`npx` 本身可能仍需下载 npm 包；`--dry-run` 只表示 REA 不应用配置计划。

### 3.2 一次性使用 CLI

无需全局安装即可运行：

```powershell
npx -y rea-agents@latest analyze-javascript-application "D:/absolute/path/to/app" --json
```

这里的 `-y` 自动同意 npm 的临时包下载，但不会自动批准 REA 的 `setup` 配置变更。若希望人工确认 npm 下载，可去掉 `-y`。

### 3.3 可选的全局安装

```powershell
npm install --global rea-agents
rea --help
```

全局安装适合频繁使用 CLI，但会增加一个需要独立更新的全局工具。更新应使用该安装自身的维护流程：

```powershell
rea update
```

## 4. 从当前源码构建

在 PowerShell 中进入源码目录：

```powershell
Set-Location "D:\AI-tools-lab\rea-study\rea"
```

使用 `.nvmrc` 指定的 Node.js，并确认 npm 版本后执行：

```powershell
npm ci
npm run check:fast
npm run build:cached
```

命令含义：

- `npm ci`：严格按照 `package-lock.json` 安装依赖，并准备 Husky hooks；不构建运行时。
- `npm run check:fast`：运行缓存化的类型检查和 lint。
- `npm run build:cached`：编译 TypeScript 运行时并构建打包 Skill。

构建完成后：

```powershell
node scripts/rea.mjs --help
node scripts/rea.mjs mcp
```

第二条命令启动 stdio MCP Server，通常应由 MCP 客户端启动，而不是在普通终端里长期手工运行。

### 源码目录注意事项

- `rea-study/rea` 是 Git submodule；不要把 `node_modules/`、`dist/` 或本地实验结果提交到父仓库。
- 构建前后都应检查 `git -C rea-study/rea status --short`，确认没有意外修改源码。
- 当前 submodule 的 `package.json` 版本为 `6.4.0`，但提交位于该标签之后；不能仅凭版本字符串断言它与 npm `6.4.0` 字节一致。

## 5. 按任务安装 provider

REA 的基础 CLI 不要求一次安装所有外部工具。先确定任务，再准备对应 provider。

| 任务 | 额外要求 |
| --- | --- |
| JavaScript/Electron 静态分析 | Node.js 与 npm；不需要 Hopper/Ghidra |
| .NET 元数据与 CIL 静态检查 | 不需要原生分析引擎 |
| 原生二进制深度分析 | Hopper、Ghidra 或 IDA |
| 网站与浏览器观察 | Chrome 系浏览器 |
| Android APK 深度分析 | 完整 JDK 与 headless JADX |
| Android 设备 | 调用方提供 `adb` |
| 固件 | Linux 上的 Binwalk 或 Unblob |
| 抓包文件 | Linux 上的 TShark 4.x 与 `prlimit` |
| 逻辑信号 | Linux 上的 sigrok-cli 0.7.2 与 `prlimit` |

### Windows 上的 Ghidra

当前文档确认的 Windows 边界是实验性 x64 P0：

- Windows 10+ x64；
- 目标与临时目录位于固定本地 NTFS 卷；
- Ghidra 12.1.x，已验证版本为 12.1.4；
- 符合 Ghidra 要求的 64 位完整 JDK，当前 12.1 版本要求 JDK 21+；
- 主要支持 x86/x86-64 PE 应用与 DLL；
- Windows P0 保持只读，不能视为 Linux/macOS 的完整功能等价物。

示例环境变量：

```powershell
$env:GHIDRA_INSTALL_DIR = "C:\tools\ghidra_12.1.4_PUBLIC"
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
rea doctor --provider ghidra --json
rea providers --json
```

REA 不会替用户安装 Ghidra、Java 或 Python。Hopper 安装在 Windows 上不可用。

## 6. 安装后验证

先验证 REA 自身和明确选择的范围：

```powershell
rea doctor --json
rea doctor --client codex --json
rea doctor --skill --json
rea doctor --provider ghidra --json
```

只运行与你当前任务相关的检查。全量 `doctor` 中某个可选 provider 失败，不代表静态 JavaScript 等无关能力不可用。

建议记录：

| 项目 | 记录内容 |
| --- | --- |
| REA 来源 | npm 发布包 / 当前源码构建 |
| REA 版本或提交 | 版本号；源码构建再记录 commit |
| Node/npm | 实际版本 |
| 操作系统 | 版本与架构 |
| 目标工作流 | JavaScript / Ghidra / 浏览器等 |
| Doctor 结论 | 对应 scope 是否 healthy |
| 未验证项 | 尚未实测的 provider 或目标类型 |

## 7. 常见问题

### 提示 compiled runtime missing

这是源码检出后尚未构建 `dist/` 的典型情况。执行：

```powershell
npm ci
npm run build:cached
```

### `doctor` 不是全绿

先检查失败项是否属于当前任务。使用 `--provider`、`--client` 或 `--skill` 缩小诊断范围，不要为了无关 provider 盲目安装大量软件。

### `@latest` 没有源码中的某项功能

`main` 可能领先已发布 npm 包。核对 npm 实际版本、当前源码提交以及连接中 MCP Server 的真实工具列表。不要用 `package.json` 中相同的版本字符串替代字节级一致性验证。

### 分析会不会执行目标

取决于工作流。JavaScript/Electron 目录或 ASAR 的静态分析读取文件而不执行应用；浏览器、Electron 运行时、进程捕获、Frida 或调试器类能力可能启动、附加或与目标交互。执行前必须阅读对应指南和工具 effects。

## 8. 参考资料

- [项目中文说明](../rea/README_zh.md)
- [安装与设置](../rea/docs/installation.md)
- [CLI 与 Evidence](../rea/docs/cli.md)
- [Windows Ghidra P0](../rea/docs/windows-ghidra-p0.md)
- [开发贡献说明](../rea/CONTRIBUTING.md)
- [项目概览](01-overview.md)
