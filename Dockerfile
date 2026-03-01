# Build dependencies
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN bun install

# Build Next.js app
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN bun run build
RUN bun build src/db/migrate-idempotent.ts --target=node --outfile=migrate-idempotent.js

# Production runtime
# IMPORTANT: Use node:20-slim (Debian), NOT Alpine.
# The builder (oven/bun:1) is Debian-based and produces glibc-linked binaries.
# Alpine uses musl libc which is incompatible with those binaries.
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

COPY --from=builder /app/migrate-idempotent.js ./
COPY --from=builder /app/src/db/migrations ./src/db/migrations

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
