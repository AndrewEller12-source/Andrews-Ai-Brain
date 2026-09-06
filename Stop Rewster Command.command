#!/bin/bash
set -eu
TASK_ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$TASK_ROOT"
export PATH="$TASK_ROOT/runtime/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
node scripts/stop.mjs
