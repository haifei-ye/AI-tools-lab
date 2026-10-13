# AI-tools-lab

用于学习和记录 AI 工具的实验仓库。

## REA 学习模块

[`rea-study`](rea-study/) 用于学习 [REA（Reverse Engineer Anything）](https://github.com/morluto/rea)。

- `rea-study/rea`：REA 官方源码，以 Git submodule 方式引入。
- `rea-study/notes`：学习笔记目录。

克隆本仓库时，请同时初始化 submodule：

```bash
git clone --recurse-submodules https://github.com/haifei-ye/AI-tools-lab.git
```

如果已经完成普通克隆，可运行：

```bash
git submodule update --init --recursive
```
