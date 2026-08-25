#!/bin/sh
set -e

echo "=============================================="
echo " Container Tracker — starting"
echo "=============================================="

if [ "${SKIP_MIGRATIONS}" = "true" ]; then
  echo "[entrypoint] SKIP_MIGRATIONS=true — skipping database migrations"
else
  echo "[entrypoint] Running database migrations"
  cd /app/migrator && node migrate.mjs && cd /app
fi

exec "$@"
