FROM node:24-bookworm-slim AS build

WORKDIR /workspace

RUN corepack enable
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack pnpm install --frozen-lockfile

COPY . .

# The placeholder satisfies Prisma 7 config during generation; it is not used to connect.
RUN DATABASE_URL='postgresql://build:build@127.0.0.1:5432/build?schema=public' corepack pnpm db:generate
RUN corepack pnpm nx build api --configuration=production
RUN corepack pnpm nx run api:prune

FROM node:24-bookworm-slim AS production-dependencies

WORKDIR /app

RUN corepack enable \
    && apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /workspace/dist/apps/api/package.json ./package.json
COPY --from=build /workspace/dist/apps/api/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /workspace/dist/apps/api/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /workspace/dist/apps/api/workspace_modules ./workspace_modules

ENV NODE_ENV=production

RUN corepack pnpm install --prod --frozen-lockfile

FROM production-dependencies AS migrate

RUN corepack pnpm install --prod=false --frozen-lockfile

COPY --from=build /workspace/prisma.config.ts ./prisma.config.ts
COPY --from=build /workspace/apps/api/prisma ./apps/api/prisma

CMD ["corepack", "pnpm", "exec", "prisma", "migrate", "deploy"]

FROM production-dependencies AS runtime

ENV NODE_ENV=production \
    PORT=3000

COPY --from=build --chown=node:node /workspace/dist/apps/api/main.js ./main.js

USER node

EXPOSE 3000

CMD ["node", "main.js"]
