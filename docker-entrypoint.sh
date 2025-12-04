#!/bin/sh
set -e

echo "🚀 Starting OpenPlaud..."

echo "⏳ Running database migrations..."
bun migrate.js

echo "🚀 Starting application..."
exec "$@"
