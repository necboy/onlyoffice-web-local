# Docker 打包与发布指南

镜像仓库：`docker.dsai.vip/mantis/onlyoffice-web-local`

---

## 前置条件

- Docker >= 20.10（含 buildx 插件）
- 已安装 Node.js（用于读取 `package.json` 版本号）
- 对 `docker.dsai.vip` 有推送权限

---

## 快速开始

### 第一次使用

```bash
# 1. 初始化多架构 builder（仅需执行一次）
make setup

# 2. 登录私有仓库
make login

# 3. 构建并发布
make release
```

### 日常发布

```bash
make release
```

---

## 命令说明

| 命令 | 说明 |
|------|------|
| `make help` | 显示帮助信息 |
| `make setup` | 初始化多架构 buildx builder |
| `make login` | 登录到 `docker.dsai.vip` |
| `make build` | 本地单架构构建（仅测试用，不推送） |
| `make release` | 多架构构建并推送到仓库（生产发布） |
| `make tag-latest` | 将指定版本重新标记为 `latest` 并推送 |

---

## 可覆盖变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VERSION` | 读取 `package.json` | 镜像版本号 |
| `PLATFORMS` | `linux/amd64,linux/arm64` | 构建目标平台 |
| `REGISTRY` | `docker.dsai.vip` | 镜像仓库地址 |
| `NAMESPACE` | `mantis` | 仓库命名空间 |

---

## 使用示例

```bash
# 发布当前版本（版本号自动从 package.json 读取）
make release

# 发布指定版本
make release VERSION=2.0.0

# 仅构建 amd64 架构
make release PLATFORMS=linux/amd64

# 将 1.2.0 重新标记为 latest
make tag-latest VERSION=1.2.0
```

---

## 多架构说明

`make release` 使用 `docker buildx` 同时构建 `linux/amd64` 和 `linux/arm64`，
构建完成后直接推送到仓库，本地不会保存镜像。

如需在本地查看镜像（仅当前机器架构），使用：

```bash
make build   # 构建并 load 到本地 Docker，不推送
```

> **注意**：多架构镜像无法 `--load` 到本地，`make build` 仅为单架构本地测试使用。

---

## 版本号管理

版本号自动从 `package.json` 的 `version` 字段读取，升级版本只需：

```bash
# 修改 package.json 中的 version 字段后
make release   # 自动使用新版本号
```
