FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY src/ ./src/
COPY drizzle/ ./drizzle/
COPY package.json drizzle.config.ts tsconfig.json ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
