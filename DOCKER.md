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
| `NODE_BASE_IMAGE` | `docker.io/library/node:20-alpine` | Node 构建基础镜像 |
| `NGINX_BASE_IMAGE` | `docker.io/library/nginx:1.19.1-alpine` | Nginx 运行基础镜像 |

---

## 使用示例

```bash
# 发布当前版本（版本号自动从 package.json 读取）
make release

# 发布指定版本
make release VERSION=2.0.0

# 仅构建 amd64 架构
make release PLATFORMS=linux/amd64

# 使用指定镜像站的基础镜像
make release NODE_BASE_IMAGE=registry/library/node:20-alpine NGINX_BASE_IMAGE=registry/library/nginx:1.19.1-alpine

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

## CDN 缓存与 HTTPS 预览

构建会根据内置编辑器脚本生成资源版本，贯穿 API 脚本、编辑器 iframe 的 `_dc` 参数和 RequireJS 的 `v` 参数，避免发布后浏览器继续命中旧版 gzip 缓存。请重新构建并部署完整产物；首次启用时同时清理 CDN 中 `/web-apps/` 下已有缓存（包括 gzip 变体）。

外部系统生成预览链接时，HTTPS 页面中的 `url` 参数也必须指向 HTTPS 文件下载地址。即使 HTTP 下载地址会重定向到 HTTPS，浏览器仍可能在发起请求前阻止它；在新窗口打开也不能修复该问题。

若控制台出现 `/fonts/<编号>` 的 404，请检查部署产物中是否存在 `sdkjs/common/AllFonts.js` 所引用的对应字体文件。仓库只包含部分字体，补充字体时需使用有授权的文件。
