# ============================================================
# Docker 打包 & 发布 Makefile
# ============================================================

REGISTRY   := docker.dsai.vip
NAMESPACE  := mantis
IMAGE_NAME := onlyoffice-web-local
VERSION    := $(shell node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")
FULL_IMAGE := $(REGISTRY)/$(NAMESPACE)/$(IMAGE_NAME)

# 多架构平台，可通过 PLATFORMS=linux/amd64 覆盖
PLATFORMS  ?= linux/amd64,linux/arm64

# buildx builder 名称
BUILDER    := multiarch-builder

.PHONY: help setup login build release release-prebuilt tag-latest

## 显示帮助信息
help:
	@echo ""
	@echo "  使用方法: make <target>"
	@echo ""
	@echo "  Targets:"
	@echo "    setup            初始化多架构 buildx builder (首次使用执行一次)"
	@echo "    login            登录到 $(REGISTRY)"
	@echo "    build            本地构建单架构镜像 (仅用于本地测试)"
	@echo "    release          多架构构建并直接推送到仓库 (需容器内网络正常)"
	@echo "    release-prebuilt 本地 pnpm build 后推送 (容器无法访问 npm 时使用)"
	@echo "    tag-latest       为指定版本重新打 latest 标签并推送"
	@echo ""
	@echo "  变量:"
	@echo "    VERSION     镜像版本 (当前: $(VERSION))"
	@echo "    PLATFORMS   构建平台 (当前: $(PLATFORMS))"
	@echo "    REGISTRY    镜像仓库 (当前: $(REGISTRY))"
	@echo ""
	@echo "  示例:"
	@echo "    make setup                           # 初始化 buildx (首次)"
	@echo "    make release                         # 发布 v$(VERSION) 多架构镜像"
	@echo "    make release VERSION=2.0.0           # 指定版本号发布"
	@echo "    make release PLATFORMS=linux/amd64   # 仅发布单架构"
	@echo ""

## 初始化多架构 buildx builder
setup:
	@echo ">>> 检查 buildx builder: $(BUILDER)"
	@docker buildx inspect $(BUILDER) > /dev/null 2>&1 \
		&& echo ">>> Builder 已存在，跳过创建" \
		|| (docker buildx create --name $(BUILDER) --driver docker-container --bootstrap \
			&& echo ">>> Builder 创建成功: $(BUILDER)")
	docker buildx use $(BUILDER)
	@echo ">>> 当前 builder:"
	@docker buildx inspect --bootstrap

## 登录私有镜像仓库
login:
	@echo ">>> 登录到 $(REGISTRY) ..."
	docker login $(REGISTRY)

## 本地构建单架构镜像 (供本地测试，不推送)
build:
	@echo ">>> 本地构建 (单架构): $(FULL_IMAGE):$(VERSION)"
	docker build \
		--build-arg BUILDKIT_INLINE_CACHE=1 \
		-t $(FULL_IMAGE):$(VERSION) \
		-t $(FULL_IMAGE):latest \
		.
	@echo ">>> 构建完成，镜像已加载到本地 Docker"

## 多架构构建并直接推送到仓库 (生产发布)
release:
	@echo ">>> 多架构发布: $(FULL_IMAGE):$(VERSION)"
	@echo ">>> 目标平台: $(PLATFORMS)"
	docker buildx build \
		--builder $(BUILDER) \
		--platform $(PLATFORMS) \
		--build-arg BUILDKIT_INLINE_CACHE=1 \
		-t $(FULL_IMAGE):$(VERSION) \
		-t $(FULL_IMAGE):latest \
		--push \
		.
	@echo ""
	@echo ">>> 发布成功!"
	@echo "    $(FULL_IMAGE):$(VERSION)"
	@echo "    $(FULL_IMAGE):latest"
	@echo "    平台: $(PLATFORMS)"

## 为已推送的版本重新打 latest 标签
tag-latest:
	@echo ">>> 拉取 $(FULL_IMAGE):$(VERSION) 并重新推送为 latest"
	docker buildx imagetools create \
		-t $(FULL_IMAGE):latest \
		$(FULL_IMAGE):$(VERSION)
	@echo ">>> 完成: $(FULL_IMAGE):latest -> $(VERSION)"
