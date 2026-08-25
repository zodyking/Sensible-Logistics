# syntax=docker/dockerfile:1
# Container Tracker — multi-stage production image (Nuxt 4 / Nitro node-server).

# ---------------------------------------------------------------------------
# builder: install deps, compile Nuxt, and vendor a self-contained migrator
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

# `npm ci` would run `nuxt prepare` (postinstall) before source is copied.
# Install with --ignore-scripts, then run `nuxt prepare` explicitly after COPY.
# --legacy-peer-deps: npm 10 arborist peer-resolution bug with Nuxt 4.5.
RUN npm ci --legacy-peer-deps --no-audit --no-fund --ignore-scripts

COPY . .

RUN npx nuxt prepare && npm run build

# Vendor drizzle-orm + pg so the runtime image can migrate with no network.
RUN mkdir -p /migrator \
  && cd /migrator \
  && npm init -y > /dev/null \
  && npm pkg set type=module \
  && npm install --legacy-peer-deps --omit=dev --no-audit --no-fund --no-package-lock drizzle-orm@0.45.2 pg@8.23.0

# ---------------------------------------------------------------------------
# runner: minimal production image, non-root, busybox wget HEALTHCHECK
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

ENV NODE_ENV=production
ENV PORT=3847
ENV HOST=0.0.0.0

# uid 1001: the base image already has `node` at uid 1000.
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nuxt \
  && apk add --no-cache tesseract-ocr tesseract-ocr-data-eng

WORKDIR /app

COPY --from=builder --chown=nuxt:nodejs /app/.output ./.output
COPY --from=builder --chown=nuxt:nodejs /migrator ./migrator
COPY --chown=nuxt:nodejs drizzle ./migrator/drizzle
COPY --chown=nuxt:nodejs docker/migrate.mjs ./migrator/migrate.mjs
COPY --chown=nuxt:nodejs docker/entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

USER nuxt

EXPOSE 3847

# busybox wget (already in alpine) — no extra apk layer.
# --quiet is used instead of GNU wget's --no-verbose (busybox does not support it).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3847/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/.output/server/index.mjs"]
