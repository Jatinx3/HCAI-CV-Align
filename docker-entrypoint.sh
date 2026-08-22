#!/bin/sh
set -e

# Everything that has to outlive a redeploy lives under one directory: the
# SQLite file and Tectonic's LaTeX package cache. Where that directory is
# depends on the host — a mounted block device on Render, /home on Azure App
# Service — so it is derived from DATABASE_URL rather than hardcoded, and the
# image works on both without a rebuild.
DB_PATH="$(printf '%s' "${DATABASE_URL:-file:/data/dev.db}" | sed 's/^file://')"
DB_DIR="$(dirname "${DB_PATH}")"

mkdir -p "${DB_DIR}" "${TECTONIC_CACHE_DIR:-${DB_DIR}/tectonic-cache}"
npx prisma migrate deploy

# Render, Azure App Service and Railway all inject the port to listen on;
# default to 3000 elsewhere.
exec npx next start -p "${PORT:-3000}" -H 0.0.0.0
