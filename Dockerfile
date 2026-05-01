# 使用阿里云 Docker Hub 镜像，避免 buildx 容器内访问 docker.io 超时
FROM docker.m.daocloud.io/library/node:20-alpine AS build-stage

WORKDIR /app
RUN corepack enable
RUN corepack prepare pnpm@10 --activate

RUN npm config set registry https://registry.npmmirror.com

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY . .
RUN pnpm build

# 若要开启gzip请将nginx镜像改为完整包
FROM docker.m.daocloud.io/library/nginx:1.19.1-alpine AS production-stage

COPY --from=build-stage /app/html /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]