FROM node:20-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/ ./shared/
COPY client/ ./client/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @legionaires/shared build
RUN pnpm --filter federation-legionaires-client build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/client/dist ./dist
EXPOSE 8080
CMD ["serve", "-s", "dist", "-l", "8080"]
