# AI-tools-lab

用于学习和记录 AI 工具的实验仓库。

## REA 学习模块

[`rea-study`](rea-study/) 用于学习 [REA（Reverse Engineer Anything）](https://github.com/morluto/rea)。

- `rea-study/rea`：REA 官方源码，以 Git submodule 方式引入。
- `rea-study/notes`：学习笔记目录。

当前学习笔记：

- [`01-overview.md`](rea-study/notes/01-overview.md)：项目用途、技术栈、目录结构、核心模块和学习路线。
- [`02-install.md`](rea-study/notes/02-install.md)：安装方式、运行要求、provider 准备和环境诊断。
- [`03-architecture.md`](rea-study/notes/03-architecture.md)：分层架构、会话、provider 路由、Evidence 和资源管理。
- [`04-first-test.md`](rea-study/notes/04-first-test.md)：最小 JavaScript 静态分析测试与验收方法。

克隆本仓库时，请同时初始化 submodule：

```bash
git clone --recurse-submodules https://github.com/haifei-ye/AI-tools-lab.git
```

如果已经完成普通克隆，可运行：

```bash
git submodule update --init --recursive
```
