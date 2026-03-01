#!/bin/sh
set -e

echo "🚀 Starting OpenPlaud..."

if [ -n "$DATABASE_URL" ]; then
  echo "⏳ Running database migrations..."
  node migrate-idempotent.js
else
  echo "⚠️ DATABASE_URL not set, skipping migrations"
fi

echo "🚀 Starting application..."
exec "$@"
