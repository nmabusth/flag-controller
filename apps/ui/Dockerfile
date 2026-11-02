FROM node:22-bookworm-slim AS base
ARG PNPM_VERSION="12.6.0"
ARG TURBO_VERSION="2.9.16"

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
RUN corepack prepare pnpm@${PNPM_VERSION} --activate

FROM base AS pruner
WORKDIR /app
RUN pnpm add -g turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune flag-controller-ui --docker

FROM base AS installer
WORKDIR /app

COPY --from=pruner /app/.pnpmfile.mjs ./.pnpmfile.mjs
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

RUN pnpm install --frozen-lockfile
RUN pnpm --filter ui exec node -p "require.resolve('typescript/package.json')"
RUN pnpm --filter ui exec tsc --version

# Build the project
COPY --from=pruner /app/out/full/ .

RUN pnpm turbo build --filter=flag-controller-ui...

FROM gcr.io/distroless/nodejs22-debian13:latest AS runner
WORKDIR /app

COPY --from=installer --chown="nonroot:nonroot" /app/apps/ui/next.config.js .
COPY --from=installer --chown="nonroot:nonroot" /app/apps/ui/package.json .

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing

COPY --from=installer --chown="nonroot:nonroot" /app/apps/ui/.next/standalone ./
COPY --from=installer --chown="nonroot:nonroot" /app/apps/ui/.next/static ./apps/ui/.next/static
COPY --from=installer --chown="nonroot:nonroot" /app/apps/ui/public ./apps/ui/public

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["apps/ui/server.js"]
