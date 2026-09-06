#!/bin/bash
set -eu
TASK_ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$TASK_ROOT"
# Normal Node installations and a Codex-bundled runtime are both supported.
export PATH="$TASK_ROOT/runtime/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
if [ -f runtime/architecture ]; then
  TASK_ARCH="$(uname -m)"
  if [ "$TASK_ARCH" = x86_64 ]; then TASK_ARCH=x64; fi
  if [ "$(cat runtime/architecture)" != "$TASK_ARCH" ]; then
    echo "This package is for $(cat runtime/architecture). Download the macOS-$TASK_ARCH package for this Mac."
    read -r -p 'Press Enter to close. ' _
    exit 1
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 22.12 or newer from https://nodejs.org, then reopen this launcher.'
  read -r -p 'Press Enter to close. ' _
  exit 1
fi
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<12)){console.error("Node.js 22.12 or newer is required.");process.exit(1)}'
if [ ! -d node_modules/@openai/codex-sdk ]; then
  if command -v npm >/dev/null 2>&1; then npm install --omit=dev
  elif command -v pnpm >/dev/null 2>&1; then pnpm install --prod --frozen-lockfile
  else echo 'Install Node.js including npm from https://nodejs.org.';exit 1
  fi
fi
node scripts/launch.mjs
