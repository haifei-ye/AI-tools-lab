# REA 第一次测试：静态分析一个最小 JavaScript 项目

> 目标：完成一次可复现、低风险的 REA 分析闭环。  
> 本测试只读取一个自己创建的 JavaScript 目录，不运行其中的代码，不需要 Hopper、Ghidra、IDA、浏览器或 Electron。  
> 以下是操作手册，本次编写笔记时没有实际执行安装、构建或测试命令。

## 1. 为什么选择这个测试

初次测试不建议从原生二进制 provider 开始，因为它们涉及外部引擎、许可证、JDK、平台限制和更复杂的进程生命周期。

`analyze-javascript-application` 的优势：

- 官方文档明确支持目录或 ASAR；
- 静态读取，不执行目标应用；
- 不需要原生分析引擎；
- 输出完整 Evidence、模块关系和覆盖信息；
- 可以直接验证 REA 的核心价值：从目标文件生成带来源和限制的结构化结果。

## 2. 前置条件

必须满足：

- Node.js `22.x >= 22.19`、`24.x >= 24.11` 或 `26+`；
- npm 可用；
- 待分析目录由自己创建，或已经获得明确分析授权；
- 使用绝对路径。

检查版本：

```powershell
node --version
npm --version
```

若准备从当前源码运行，还应先按 [02-install.md](02-install.md) 完成 `npm ci` 和 `npm run build:cached`。

## 3. 创建最小测试目标

建议在 REA submodule 外创建测试目录，避免污染上游源码：

```text
D:\AI-tools-lab\rea-study\lab\first-js-app\
├─ package.json
├─ main.js
└─ greeting.js
```

### package.json

```json
{
  "name": "rea-first-test",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "main.js"
}
```

### greeting.js

```js
export const greeting = (name) => `Hello, ${name}!`;
```

### main.js

```js
import { greeting } from "./greeting.js";

export const run = () => greeting("REA");
```

这个样例只用于让分析器识别 package、入口、模块、导出和静态 import。不要添加真实密钥、账号信息或第三方私有代码。

## 4. 选择运行方式

二选一，不要把两个方式的版本结果混在同一次记录里。

### 方式 A：使用 npm 发布包

优点：不需要构建源码。  
注意：需要联网，且 `@latest` 不一定与 submodule 当前提交一致。

```powershell
npx -y rea-agents@latest analyze-javascript-application "D:/AI-tools-lab/rea-study/lab/first-js-app" --json > "D:/AI-tools-lab/rea-study/lab/first-test-result.json"
```

### 方式 B：使用当前源码构建

优点：测试结果对应当前 submodule 源码。  
前提：已在 `rea-study/rea` 中完成 `npm ci` 和 `npm run build:cached`。

```powershell
Set-Location "D:\AI-tools-lab\rea-study\rea"
node scripts/rea.mjs analyze-javascript-application "D:/AI-tools-lab/rea-study/lab/first-js-app" --json > "D:/AI-tools-lab/rea-study/lab/first-test-result.json"
```

运行时，进度 JSON 行会写入 stderr；最终 Evidence JSON 写入 stdout，所以可以安全地重定向到结果文件。

## 5. 基础验收

### 5.1 检查退出码

命令结束后立即运行：

```powershell
$LASTEXITCODE
```

期望值为 `0`。但退出码 `0` 只表示操作完成，结果仍可能包含 limitations、partial coverage 或 unresolved questions。

### 5.2 确认结果是合法 JSON

```powershell
$resultPath = "D:\AI-tools-lab\rea-study\lab\first-test-result.json"
$result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
$result.evidence_id
$result.provider
$result.subject
$result.limitations
```

若 `ConvertFrom-Json` 失败，先确认 stdout 文件中没有混入手工复制的终端提示。REA 的进度输出应位于 stderr，不应出现在结果 JSON 中。

### 5.3 查看分析摘要

```powershell
$result.normalized_result.statistics
$result.normalized_result.graph.coverage
$result.normalized_result.graph.nodes.Count
$result.normalized_result.graph.edges.Count
```

不同版本的完整字段可能变化，因此不要为第一次测试写死节点或边的精确数量。应确认以下语义：

- 目标身份与 SHA-256 已记录；
- provider 身份存在；
- `normalized_result` 存在；
- application graph 中出现测试文件或对应模块；
- `main.js` 到 `greeting.js` 的静态导入关系被识别，或 limitations 明确说明未识别原因；
- coverage 与 limitations 没有被忽略。

## 6. 推荐记录模板

把实际结果记录在单独实验笔记中，不要直接修改 REA 源码：

```markdown
# REA First Test Result

- 日期：YYYY-MM-DD
- 操作系统：
- Node.js：
- npm：
- REA 来源：npm @latest / source build
- REA 版本或 commit：
- 测试目标：first-js-app
- 命令：
- 退出码：
- evidence_id：
- provider：
- 节点数：
- 边数：
- coverage：
- limitations：
- 结论：PASS / FAIL / PARTIAL
```

判定建议：

- `PASS`：命令成功，JSON 可解析，目标身份和核心模块关系可见。
- `PARTIAL`：命令成功，但 coverage 或 limitations 表明部分关系未分析。
- `FAIL`：命令未完成、JSON 无法解析或目标输入不符合要求。

不要把 `PARTIAL` 自动写成失败，也不要把退出码 `0` 自动写成分析完整。

## 7. 可选的结果摘要

完整 Evidence 对真实应用可能很大。安装了 `jq` 时，可以先生成 summary 输入，再用 REA 投影视图：

```powershell
jq -c '{source: {kind: "inline", evidence: .}, view: {kind: "summary"}}' "D:/AI-tools-lab/rea-study/lab/first-test-result.json" > "D:/AI-tools-lab/rea-study/lab/first-test-view.json"
rea inspect-analysis-view "D:/AI-tools-lab/rea-study/lab/first-test-view.json"
```

这是可选步骤。Windows 默认不一定安装 `jq`，缺少它不影响第一次分析测试。

## 8. 常见失败与定位

### `compiled runtime is missing`

原因：从源码运行，但尚未生成 `dist/`。  
处理：在 `rea-study/rea` 中执行：

```powershell
npm ci
npm run build:cached
```

### 输入路径被拒绝

检查：

- 是否使用绝对路径；
- 目标是否为目录或 `.asar`；
- 目录是否真实存在且当前用户可读；
- 是否误把单个 `.js` 文件作为 application 目录传入。

### 结果很大

真实 Electron 应用的完整 Evidence 可能达到数百 MB。第一次测试应保持样例很小；后续使用 MCP 时可选择 `detail: "summary"`，再通过保留的 Evidence ID 分页读取。

### 输出成功但未看到预期关系

查看：

- `limitations`；
- `normalized_result.graph.coverage`；
- package root 是否被正确识别；
- import 路径是否真实存在且大小写一致。

静态 import 只证明代码结构，不证明运行时一定执行该路径。

## 9. 安全与清理

- 只使用自己创建或获准分析的目录。
- 结果 JSON 可能包含本地绝对路径、字符串、模块名或目标中的敏感内容，公开提交前必须检查。
- 不要把真实商业应用的完整 Evidence 直接提交到公开的 `AI-tools-lab` 仓库。
- 测试目标和输出应位于 `rea-study/rea` submodule 外。
- 删除测试输出前先确认路径；不要对工作区根目录使用递归删除命令。

## 10. 本测试能证明什么

完成后可以确认：

- 所选 REA 版本能够启动；
- Node/npm 基础运行环境可用；
- 静态 JavaScript application workflow 能读取本地目录；
- 结果能生成合法 JSON 和 Evidence；
- 最小模块关系可以被检查。

它不能证明：

- Hopper、Ghidra、IDA 或其他 provider 可用；
- MCP 客户端已经连接；
- 大型真实应用分析性能可接受；
- 所有测试套件通过；
- 所有静态关系都等同于运行时行为。

## 11. 参考资料

- [安装说明](02-install.md)
- [架构分析](03-architecture.md)
- [官方 CLI 与 Evidence 指南](../rea/docs/cli.md)
- [JavaScript 制品重建指南](../rea/docs/javascript-artifact-reconstruction.md)
- [项目中文说明](../rea/README_zh.md)
