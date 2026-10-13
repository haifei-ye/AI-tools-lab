# REA 学习模块

本目录用于学习和记录 [REA（Reverse Engineer Anything）](https://github.com/morluto/rea)。REA 官方项目通过 Git submodule 引入，主仓库记录其确定的上游提交版本。

## 目录结构

- `rea/`：REA 官方源码 submodule。
- `notes/`：学习笔记。

## 初始化源码

首次克隆主仓库后，运行：

```bash
git submodule update --init --recursive
```

submodule 不会随主仓库自动更新。需要升级 REA 时，应先更新 `rea/` 指向的上游提交，再在主仓库中提交新的 submodule 引用。
