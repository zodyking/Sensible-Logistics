#!/bin/sh
set -eu

echo "=============================================="
echo " Container Tracker — starting"
echo "=============================================="

if [ "${SKIP_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] SKIP_MIGRATIONS=true — skipping database migrations"
else
  echo "[entrypoint] Running database migrations"
  # `set -e` is ignored for every command of an AND-OR list except the last, so
  # the migrator's status has to be tested explicitly. The subshell keeps the
  # migrator's directory change away from the server exec below.
  if ! (cd /app/migrator && node migrate.mjs); then
    echo "[entrypoint] Migrations failed — refusing to start the server." >&2
    echo "[entrypoint] Fix the database error above and redeploy." >&2
    exit 1
  fi
fi

cd /app
echo "[entrypoint] Starting Nitro server on ${HOST:-0.0.0.0}:${PORT:-3847}"
exec "$@"
