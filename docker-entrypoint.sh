#!/bin/sh
set -e

echo "🚀 Starting OpenPlaud..."

# Run migrations
echo "⏳ Running database migrations..."
if node src/db/migrate.js; then
  echo "✅ Migrations completed successfully"
else
  echo "❌ Migration failed"
  exit 1
fi

# Start the application
echo "🚀 Starting application..."
exec "$@"

