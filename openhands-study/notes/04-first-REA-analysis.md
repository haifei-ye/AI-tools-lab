# 第一次 REA 静态分析：OpenHands

> 执行日期：2026-10-13。分析对象是 Agent Canvas 的 `src/api`，不是整个 OpenHands 多仓库系统。

## 1. 目标与范围

本次使用已经验证过的 REA npm 发布版 `rea-agents@6.4.0`，以固定 Node.js `v24.18.0` 对下列路径做静态分析：

```text
D:\AI-tools-lab\openhands-study\openhands\src\api
```

选择该范围的原因：

- `src/api` 是 Canvas 到 Agent Server/Cloud 的关键边界；
- 该目录规模适合第一次建立模块图；
- 全量 Canvas 源码约有 1416 个 JavaScript/TypeScript 文件，REA 的完整语义 Evidence 会非常大；
- SDK 核心以 Python 为主，本次使用的命令是 `analyze-javascript-application`，不能据此评价 Python Agent 核心。

执行形式：

```powershell
npx -y rea-agents@6.4.0 analyze-javascript-application `
  D:\AI-tools-lab\openhands-study\openhands\src\api --json
```

缓存被定向到 `openhands-study/.npm-cache`；原始 JSON 和错误流保存在忽略目录 `openhands-study/rea-analysis/raw-output/`，不会提交。没有在 OpenHands 子模块内安装依赖。

## 2. 执行结果

| 项目 | 结果 |
| --- | ---: |
| 进程退出码 | `0` |
| 相关文件 | `110` |
| 读取文本 | `714,127` bytes |
| 成功解析的 JavaScript/TypeScript 文件 | `110` |
| AST 节点访问量 | `70,715` |
| findings | `1,396` |
| parse failures | `0` |
| 原始 JSON 大小 | `48,901,068` bytes |
| 原始 JSON SHA-256 | `8a904ffddb59dc34162d8f4abcf1479020dff456e5af27334b0be9b4bd3df63e` |

“退出码 0、无解析失败”只说明本次静态分析命令成功完成，不等同于 OpenHands 可以运行，也不代表 REA 已完整理解所有语义。

## 3. REA 应用图

### 3.1 节点

应用图共有 `865` 个节点：

| 类型 | 数量 |
| --- | ---: |
| `javascript-module` | 644 |
| `javascript-asset` | 110 |
| `unknown` | 72 |
| `endpoint` | 26 |
| `storage` | 12 |
| `artifact` | 1 |

### 3.2 边

应用图共有 `1,530` 条边：

| 关系 | 数量 |
| --- | ---: |
| `imports` | 956 |
| `exposes` | 303 |
| `contains` | 259 |
| `persists_to` | 12 |

956 条 import 中，REA 标记：

- resolved internal：`474`
- external：`324`
- unresolved：`153`
- rejected：`5`

部分 `#/...` 路径位于本次目标目录之外，因此在这个有意缩小的分析范围中会表现为 external 或 unresolved；不能直接判定为项目代码错误。

## 4. REA 发现的模块关系

### 4.1 高连接内部模块

按内部 import 的入边数量，较突出的模块包括：

| 模块 | 内部入边（REA） | 人工解释 |
| --- | ---: | --- |
| `backend-registry/types.ts` | 54 | 多后端配置与类型的公共契约 |
| `backend-registry/active-store.ts` | 53 | 当前活动后端的集中状态入口 |
| `cloud/proxy.ts` | 40 | Cloud 请求的代理边界 |
| `agent-server-client-options.ts` | 39 | Agent Server 客户端选项组装 |
| `agent-server-compatibility.ts` | 30 | 客户端/服务端兼容性判断 |
| `agent-server-config.ts` | 27 | Agent Server 配置 |
| `conversation-service/...types.ts` | 26 | 会话服务的共享类型 |
| `agent-server-adapter.ts` | 21 | Server 数据/接口适配 |

这组结果显示，Canvas API 层的结构中心不是某个 UI 组件，而是 **后端选择、Agent Server 连接配置、兼容性和会话类型**。

### 4.2 关键链路

REA 的 import 关系支持以下链路：

```text
conversation-service/agent-server-conversation-service.api.ts
  ├─ agent-server-client-options.ts
  ├─ agent-server-adapter.ts
  ├─ canvas-ui-client-tool.ts
  ├─ conversation-workspace.ts
  ├─ conversation-metadata-store.ts
  ├─ settings-service/settings-service.api.ts
  └─ cloud/conversation-service.api.ts

cloud/* service APIs
  └─ backend-registry/active-store.ts
       ├─ backend-registry/types.ts
       ├─ backend-registry/health-store.ts
       └─ backend-registry/storage.ts

cloud/conversation-service.api.ts
  └─ cloud/proxy.ts
       └─ cloud/client.ts
```

人工结合文件职责后，可将其理解为：会话服务需要知道当前使用哪个后端，构造合适的 Agent Server 客户端，做版本/数据适配，并在 Cloud 场景通过代理发送请求。REA 提供了关系证据，但“为什么这样设计”仍需要阅读实现和架构文档。

### 4.3 存储与接口线索

REA 标记了 12 个 storage 节点和 26 个 endpoint 节点。例如 backend registry 的健康信息存在 `localStorage` 写入证据。需要注意：静态发现可能包含测试、mock 或条件分支中的接口，不能仅凭节点计数断言这些端点都会在生产运行时暴露。

## 5. REA 语义关系

语义图统计：

| 项目 | 数量 |
| --- | ---: |
| 节点 | `24,936` |
| relations | `23,128` |
| unknowns | `8,143` |
| resolved resolutions | `14,960` |
| candidate resolutions | `8,168` |

主要 relation 类型：

| 关系 | 数量 |
| --- | ---: |
| `aliases` | 7,429 |
| `reads` | 6,059 |
| `defines` | 2,832 |
| `captures` | 2,738 |
| `reads-property` | 1,685 |
| `returns-to-call` | 732 |
| `calls` | 512 |
| `argument-to-parameter` | 451 |
| `awaits` | 278 |
| `writes-property` | 215 |

REA 能保留大量绑定、调用、属性读取、异步等待和参数传递关系，这比只看 import 图更接近代码内部的数据流。不过该语义图明确标记为 **partial 且 truncated**，不能把这些数量当作目标目录的完整语义总量。

## 6. Evidence

本次产物的 Evidence/图标识如下，便于之后核对同一份原始输出：

| 标识 | 值 |
| --- | --- |
| Evidence ID | `ev_e96cbb2ada39057f9808e858f318573ac58d4df65110d1b6dd57819946365159` |
| Subject/root SHA-256 | `df49b22783d66f3b3cb4f4c39a68f5b58a78632f708d3ac34e78fceb267f2957` |
| Manifest | `agm_b181af81d778dfbcc333ebb4a41a149b9807bb5d2ddef4eafb3bd130995f4e2f` |
| Inventory graph | `90d70eac2bf98ed6252780c94024b6977cc3b8f0cc0f0808347362f3f1699f57` |
| Application graph | `jag_8b43bb173ba7436df18a1e3c72b09ab13cabb114131cdf10015ec896934eb9c0` |
| Semantic graph | `jsrg_27dde274725b8a5380a7f96e23db0cfc1a46577cf00151b3215df4cb4aacdb0d` |
| Provider | `rea-javascript-application` |
| Authority | `shipped-artifact` |
| Confidence | `derived` |

原始 JSON 是本机测试记录，不纳入 Git；上表保留复核所需的稳定标识和哈希。

## 7. 人工补充理解

### REA 没有直接告诉我们的内容

1. **当前官方项目是多仓库架构**：Canvas 主仓库不含完整 Agent 核心；这一点来自官方 README、架构文档和仓库边界阅读。
2. **Agent 的真实主循环在 Python SDK**：本次 JavaScript 分析无法覆盖 `Agent.step()`、Conversation、condenser、ToolExecutor 和 Workspace。
3. **Planner 不是通用中央类**：它主要是一个配置过的 Agent preset，需要人工在 Python 代码中确认。
4. **“Memory”有多种含义**：持久 `MEMORY.md`、会话事件/压缩、进程内 FileStore 必须人工区分。
5. **安全边界依赖 Workspace**：Local、Docker、Sandbox 和远程工作区的风险不同，import 图不能验证隔离强度。

### REA 比普通阅读更有帮助的地方

- 快速量化目标目录规模，并确认 110 个文件全部解析成功；
- 从 956 条 import 中找出后端注册、连接配置和会话适配等高连接节点；
- 把跨目录链路变成可查询关系，而不必逐个手工追踪 import；
- 生成可复核的 Evidence ID、图哈希和原始输出哈希；
- 暴露 unresolved/unknown/truncation，让“尚未理解的部分”可见。

### 仍需人工理解的地方

- 模块的业务意图、设计权衡与实际运行顺序；
- 类型关系是否在特定条件分支中真正发生；
- 动态路由、运行时配置、反射、网络响应和后端行为；
- Python Agent 核心及跨语言边界；
- 安全性、正确性、性能与端到端任务效果。

## 8. REA 分析限制

- **范围限制**：只分析 `openhands/src/api`，不是整个 Canvas，更不是整个 OpenHands 系统。
- **语言限制**：使用 JavaScript Application 分析器，没有覆盖 Python SDK。
- **结果预算**：应用图是 partial；语义图是 partial 且 truncated，多项语义族有未保留或未开始的内容。
- **静态分析限制**：无法完整解析运行时动态导入、外部服务响应、环境变量分支和真实网络/进程行为。
- **计数限制**：endpoint、storage、unknown 等节点是分析模型分类，不自动等于生产部署中的真实资源数量。
- **版本限制**：结果只对应固定 submodule 提交与 `rea-agents@6.4.0`。

## 9. 阶段结论

这次实验确认 REA 能为 OpenHands Canvas 的 API 边界建立有 Evidence 的模块图，并快速识别后端注册、会话服务、Agent Server 适配和 Cloud 代理之间的关系。它最适合作为“导航与证据层”，不能替代官方架构文档、Python 核心代码阅读和后续受控运行实验。
