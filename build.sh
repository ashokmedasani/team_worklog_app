#!/usr/bin/env bash
set -euo pipefail

echo "Installing dependencies..."
npm install

echo "Building client..."
npm run build

echo "Creating/updating first admin users..."
npm run seed

echo "Build completed."
