# REA npm 发布版与当前源码版能力对比

> 测试日期：2026-10-13  
> npm 发布版：`rea-agents@6.4.0`  
> 当前源码：`4773c152bc5f299fa682575bb8d1efea7587c7bc`  
> Node.js：`v24.18.0`  
> npm：`11.16.0`  
> 目标项目：`node-fetch` commit `8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f`  
> 最终判定：**npm 发布版成功完成完整静态分析；当前源码版只能返回文件清点级 partial Evidence。**

## 1. 先纠正一个容易误解的前提

两个被测对象的 `package.json` 都显示版本 `6.4.0`，但它们不是同一份代码：

- npm `rea-agents@6.4.0` 对应 tag commit：`a56f7bb668ab23fec8d33f7af353ac7ed2fe1895`；
- 当前 submodule commit：`4773c152bc5f299fa682575bb8d1efea7587c7bc`；
- 当前源码位于 tag 之后 372 个提交，`git describe` 为 `rea-agents-6.4.0-372-g4773c152b`。

因此，本测试比较的是“**正式发布包 6.4.0 的可运行能力**”和“**当前开发源码 checkout 在本机的可运行能力**”，不是只比较两代分析算法。发布版成功、源码版失败的直接差异是发布包具备可用的 Windows 原生 artifact，而当前源码 checkout 缺少 `native/windows/build/manifest.json`。

## 2. 测试隔离与输入一致性

独立测试目录：

```text
D:\AI-tools-lab\rea-study\examples\release-version-test
```

目标目录沿用第一次源码测试中的同一份 checkout：

```text
D:\AI-tools-lab\rea-study\examples\first-real-analysis\target\node-fetch
```

发布版和源码版返回的以下身份完全相同，确认输入文件没有变化：

| 身份字段 | 两次测试共同值 |
| --- | --- |
| node-fetch commit | `8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f` |
| subject/root SHA-256 | `2b9b251628b7024d7b16dfde605920ff6da81c6cf3b92bd4631e055061a53130` |
| inventory manifest | `agm_c0d03354b4312868b06fe0d5b93895eae81e919bb9c4fdf6754efcf1311bac71` |
| inventory graph SHA-256 | `02d5db757ad17527a073984cb05bd95c31fe9ea17f58bf9a0cd2a52846bd32d9` |
| relevant files | 26 |
| text bytes read | 220,283 |

源码版显式使用 `format=directory`，本次发布版使用命令默认的 `format=auto`；REA 自动识别结果仍为 `directory`，且上述目标和 inventory 摘要全部一致。

## 3. 实际命令

在独立测试目录中，临时把专用 Node 放到本进程 PATH 首位，并把 npm cache 定向到该测试目录后执行：

```powershell
npx -y rea-agents@6.4.0 analyze-javascript-application `
  "D:\AI-tools-lab\rea-study\examples\first-real-analysis\target\node-fetch" `
  --json
```

固定版本经 npm registry 元数据再次确认：

```text
version: 6.4.0
integrity: sha512-Vj1zWfSlna5bphGoaoI/TcVBuYvze9u+OyPC3Shz8YkBqaCTqB4COnnRoX7XDwMpwI24ZlFEel2yEj0k8LTWEQ==
```

没有执行 npm 升级；stderr 中出现的 npm 12.2.0 提示仅是通知。

## 4. 是否成功与退出码

| 项目 | npm 发布版 6.4.0 | 当前源码版 |
| --- | ---: | ---: |
| 是否完成分析 | **成功** | **失败，但包含 partial Evidence** |
| exit code | **0** | **1** |
| 错误代码 | 无 | `capability_unavailable` |
| 错误分类 | 无 | `unsupported_provider` |
| 直接失败原因 | 无 | 缺少 Windows native controls manifest |

发布版 stderr 记录了从 inventory、26 个源文件投影、application graph、semantic graph 到 Evidence seal/hash 的 39 个进度事件，最后事件为：

```text
Application graph and Electron boundaries reconstructed
```

## 5. parsed_javascript_files

| 指标 | npm 发布版 6.4.0 | 当前源码版 | 差异 |
| --- | ---: | ---: | ---: |
| `parsed_javascript_files` | **25** | **0** | +25 |
| `visited_ast_nodes` | **32,516** | **0** | +32,516 |
| `parse_failures` | **0** | **0** | 0 |
| `findings` | **373** | **0** | +373 |

26 个 relevant files 中包含 `package.json`；REA 进度日志显示它投影了 26 个 application source files，而结果统计字段明确记录 25 个 parsed JavaScript files。不能把二者混写成 26 个 JavaScript 文件。

## 6. Application graph

| 指标 | npm 发布版 6.4.0 | 当前源码版 |
| --- | ---: | ---: |
| graph nodes | 263 | 53 |
| graph edges | 447 | 52 |
| coverage | `partial` | `partial` |
| truncated | `false` | `false` |

发布版的 447 条 application graph 边包括：

| 关系 | 数量 |
| --- | ---: |
| `imports` | 292 |
| `exposes` | 58 |
| `contains` | 52 |
| `calls` | 43 |
| `maps_to` | 1 |
| `loads` | 1 |

## 7. Semantic relations

### 总量

| 指标 | npm 发布版 6.4.0 | 当前源码版 |
| --- | ---: | ---: |
| semantic nodes | **21,713** | 25 |
| semantic relations | **22,970** | 0 |
| semantic unknowns | **8,062** | 300 |
| omitted nodes | 0 | 未知 |
| omitted relations | 0 | 未知 |
| truncated | `false` | `false` |

发布版 unknown 数量更高不表示能力变差。源码版没有进入 AST 分析，只为未分析文件留下 300 个概括性 unknown；发布版展开了 21,713 个语义节点，因此也保留了更多细粒度的不确定关系。

### 按关系族统计

| semantic family | retained relations | unknown IDs | coverage |
| --- | ---: | ---: | --- |
| data-flow | 18,418 | 1,372 | partial |
| closure | 2,197 | 0 | partial |
| object-flow | 1,587 | 2,854 | partial |
| promise-ownership | 442 | 336 | partial |
| call-flow | 259 | 3,492 | partial |
| event | 35 | 7 | partial |
| timer | 18 | 0 | partial |
| boundary | 13 | 1 | partial |
| resource-lifecycle | 1 | 0 | partial |
| child-process | 0 | 0 | partial |
| configuration | 0 | 0 | partial |
| request | 0 | 0 | partial |
| **合计** | **22,970** | **8,062** | overall `unknown` |

各族均标为 `partial`，所以 0 条关系只能解释为“本次静态恢复没有保留该族关系”，不能证明项目中不存在相应运行时行为。

### 主要关系类型

发布版保留的关系以静态数据流为主：

| relation | 数量 |
| --- | ---: |
| `aliases` | 11,964 |
| `reads` | 4,682 |
| `captures` | 2,197 |
| `defines` | 1,609 |
| `reads-property` | 1,466 |
| `awaits` | 278 |
| `writes` | 163 |
| `writes-property` | 103 |
| `argument-to-parameter` | 98 |
| `calls` | 88 |
| `creates-promise` | 87 |
| `returns-to-call` | 73 |

全部 22,970 条中，10,248 条 resolution 为 `resolved`，12,722 条为保守的 `candidate`。这些关系来自惰性 AST 静态分析，不证明运行时一定执行。

## 8. Evidence

### npm 发布版

| 字段 | 值 |
| --- | --- |
| Evidence ID | `ev_40845ad207efb1cb335cc8cb5762ab0710bfdcaed24d70b5e4a030209ea88a7d` |
| Provider | `rea-javascript-application` / version `1` |
| Authority | `shipped-artifact` |
| Confidence | `derived` |
| Application graph ID | `jag_592f945720a0959f5e495a304eef668c38f2f608a3750052125d0251558db809` |
| Semantic graph ID | `jsrg_e6c33ede16aa5db966c0339b9052e4bed914d0a51901291c9e46c4f180845ecf` |
| Application evidence records | 804 |
| Semantic evidence contexts | 576 |

804 条 application Evidence 的来源分布：

- 599 条 `static-relationship-inference`；
- 151 条 `ast-static-analysis`；
- 54 条 `artifact-bytes`；
- 205 条是 `observed`，599 条是 `inferred`；
- confidence 分布为 exact 205、high 330、medium 94、low 175。

这说明输出同时包含精确文件/AST 观察和不同置信度的静态推断，不能把所有关系都当成同等确定的事实。

### 当前源码版

| 字段 | 值 |
| --- | --- |
| Evidence ID | `ev_62e7963f2179cc95594ad00b9979562160ad1c6349724bb2e8ad9ba450a74a5d` |
| Application graph ID | `jag_3a1c4a9522cc6c0b5b6c3dabd9eab070ba16eb554ace714975911ab6c0657178` |
| Semantic graph ID | `jsrg_f6ef732e7a135afa7d73d7c85174aac4255b741894a6b53c84a0bb40a312c1eb` |
| Evidence 状态 | error envelope 中的 `partial_observation` |

源码版 Evidence 可靠地证明了目标身份、文件 inventory 和失败边界，但没有证明模块关系、调用关系或数据流。

## 9. 能力差异判断

### 已确认事实

1. 对完全相同的 node-fetch 文件，npm 6.4.0 在当前 Windows + Node 24.18.0 环境中退出码为 0。
2. 发布版恢复 25 个 JavaScript/TypeScript 文件、447 条 application edges 和 22,970 条 semantic relations。
3. 当前源码版在建立 inventory 后因缺少 Windows native manifest 退出，AST 解析数和 semantic relations 都为 0。
4. 两次测试的 subject digest、root digest、inventory manifest 和 inventory graph digest 完全一致。
5. REA submodule 源码没有被修改。

### 合理推测

发布版的能力优势主要来自“发布 artifact 完整、Windows 原生控制层可用”，而不是因为 tag 对应的旧源码算法必然优于 372 个提交后的当前源码。若为当前 commit 配套构建正确的 Windows native artifact，它可能获得相同或更强的语义分析能力，但本次没有验证。

### 未验证信息

- 没有运行 node-fetch，因此未验证任何关系是否在运行时实际发生；
- 没有把 npm 发布包的原生文件复制进当前源码，避免版本不匹配；
- 没有比较 Linux 环境或当前源码配套 CI artifact；
- 没有评估 22,970 条关系的全部准确率，只核验了结构、计数和 Evidence 元数据；
- 没有证明 `candidate` 关系均为真实调用或数据流。

### 主观建议

现阶段进行 JavaScript/TypeScript 项目学习时，应优先固定使用 `rea-agents@6.4.0`，因为它在本机具备可复现的完整分析路径。当前源码 checkout 适合源码阅读和开发验证，但在获得与该 commit 匹配的 Windows native artifact 前，不应作为实际分析工具的默认入口。

## 10. 原始输出与缓存边界

原始输出保存在测试目录的 `raw-output/`，npm 下载缓存保存在 `.npm-cache/`；二者和 `node_modules/` 均被 `.gitignore` 排除，不进入提交。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `raw-output/release-6.4.0-analysis.json` | 39,465,121 | `7bd9ce53bf82d6b3a2e44c32186c2e0733364e3214d822ee75fc38aeb13a3760` |
| `raw-output/release-6.4.0-analysis.stderr.log` | 6,348 | `b7cd18856c201e69efc6c90ca22e38617e5b555202e04d386085de466bbc84f4` |

JSON 已通过完整解析验证；stderr 只包含结构化进度事件和 npm 版本通知，没有分析错误。
