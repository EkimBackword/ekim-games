FROM node:24-bookworm-slim AS build

WORKDIR /workspace

RUN npm install --global pnpm@11.25.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm nx build web --configuration=production

FROM nginxinc/nginx-unprivileged:alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist/apps/web/browser /usr/share/nginx/html

EXPOSE 8080
