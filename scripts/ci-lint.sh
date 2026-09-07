#!/usr/bin/env bash
#
# Mirrors the "Lint" job in .github/workflows/ci.yml:
#   - uses: actions/setup-node@v4  (node-version: 22)
#   - run: npm ci
#   - run: npm run lint
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

REQUIRED_NODE_MAJOR=22
CURRENT_NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"

if [[ "$CURRENT_NODE_MAJOR" != "$REQUIRED_NODE_MAJOR" ]]; then
  echo "warning: CI runs Node ${REQUIRED_NODE_MAJOR}.x, but this shell has Node $(node -v)." >&2
  echo "         ESLint results may differ from CI. Switch with nvm/fnm if needed." >&2
fi

echo "==> npm ci"
npm ci

echo "==> npm run lint"
npm run lint
