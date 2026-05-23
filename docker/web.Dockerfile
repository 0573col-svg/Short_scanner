# Dockerfile placeholder para el frontend.
# Build estático con Vite, servido por nginx.
# Build context esperado: raíz del monorepo.

FROM node:20-alpine AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.30.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @short-scanner/shared-types build
RUN pnpm --filter @short-scanner/web build

FROM nginx:1.27-alpine AS runner
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
