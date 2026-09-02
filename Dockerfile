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
# runner: Debian slim so OpenOCR's manylinux ONNX/OpenCV wheels can load.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PORT=3847
ENV HOST=0.0.0.0
ENV HOME=/tmp
ENV HF_HOME=/tmp/huggingface
ENV OPENOCR_WORKER=/app/ocr/openocr_worker.py
ENV YARD_WORKER=/app/yard/generate_worker.py
ENV OPENOCR_DET_MODEL=/opt/openocr/openocr_det_model.onnx
ENV OPENOCR_REC_MODEL=/opt/openocr/openocr_rec_model.onnx
ENV OPENOCR_WORKDIR=/tmp/openocr

# uid 1001: the base image already has `node` at uid 1000.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home-dir /tmp --no-create-home nuxt \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    ca-certificates \
    wget \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --break-system-packages --no-cache-dir \
    openocr-python==0.1.5 \
    onnxruntime \
  && mkdir -p /opt/openocr \
  && wget -q -O /opt/openocr/openocr_det_model.onnx \
    https://github.com/Topdu/OpenOCR/releases/download/develop0.0.1/openocr_det_model.onnx \
  && wget -q -O /opt/openocr/openocr_rec_model.onnx \
    https://github.com/Topdu/OpenOCR/releases/download/develop0.0.1/openocr_rec_model.onnx

WORKDIR /app

COPY --from=builder --chown=nuxt:nodejs /app/.output ./.output
COPY --from=builder --chown=nuxt:nodejs /migrator ./migrator
COPY --chown=nuxt:nodejs drizzle ./migrator/drizzle
COPY --chown=nuxt:nodejs docker/migrate.mjs ./migrator/migrate.mjs
COPY --chown=nuxt:nodejs docker/entrypoint.sh ./entrypoint.sh
COPY --chown=nuxt:nodejs server/ocr/openocr_worker.py /app/ocr/openocr_worker.py
COPY --chown=nuxt:nodejs server/yard /app/yard

RUN chmod +x ./entrypoint.sh \
  && chown -R nuxt:nodejs /opt/openocr /app/ocr /app/yard \
  && pip3 install --break-system-packages --no-cache-dir \
    -r /app/yard/requirements.txt || true

USER nuxt

EXPOSE 3847

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3847/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/.output/server/index.mjs"]
