#!/bin/bash
# Start hireopenclaw local development server

set -e

echo "========================================="
echo "  HireOpenClaw Local Dev Setup"
echo "========================================="
echo ""

# Check if LocalStack is running
if ! curl -sf http://localhost:4566/_localstack/health >/dev/null 2>&1; then
  echo "❌ LocalStack not running. Start it first:"
  echo "   cd ~/repos/clawops && make up"
  exit 1
fi
echo "✓ LocalStack running"

# Check if MasterControl is running
if ! curl -sf http://localhost:18790/health >/dev/null 2>&1; then
  echo "⚠️  MasterControl not responding (may still be starting...)"
else
  echo "✓ MasterControl running"
fi

# Install dependencies if needed
if [ ! -d node_modules ]; then
  echo ""
  echo "Installing dependencies..."
  npm install
fi

# Load environment variables
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
  echo "✓ Loaded .env.local"
fi

echo ""
echo "Starting server..."
echo ""

# Start server (nodemon for auto-reload if available, otherwise node)
if command -v nodemon >/dev/null 2>&1; then
  nodemon server.js
else
  node server.js
fi
