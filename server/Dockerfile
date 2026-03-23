FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/ ./shared/
COPY server/ ./server/
COPY ["New Direction Docs/", "./New Direction Docs/"]
COPY ["Unit Testing/", "./Unit Testing/"]

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @legionaires/shared build
RUN pnpm --filter federation-legionaires-server build

WORKDIR /app/server

EXPOSE 3000
CMD ["node", "dist/index.js"]
