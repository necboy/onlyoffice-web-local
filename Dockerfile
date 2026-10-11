# 基础镜像可通过 --build-arg 覆盖，避免单个镜像站不可用时阻塞发布
ARG NODE_BASE_IMAGE=docker.io/library/node:20-alpine
ARG NGINX_BASE_IMAGE=docker.io/library/nginx:1.19.1-alpine

FROM ${NODE_BASE_IMAGE} AS build-stage

WORKDIR /app
RUN corepack enable
RUN corepack prepare pnpm@10 --activate

RUN npm config set registry https://registry.npmmirror.com

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY . .
RUN pnpm build

# 若要开启gzip请将nginx镜像改为完整包
FROM ${NGINX_BASE_IMAGE} AS production-stage

COPY --from=build-stage /app/html /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
