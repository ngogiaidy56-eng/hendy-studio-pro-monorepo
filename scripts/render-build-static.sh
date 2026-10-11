#!/usr/bin/env bash
set -euo pipefail
APP="${1:-}"
case "$APP" in admin-web|studio-web|marketing-web|release-center) ;; *) echo "Usage: $0 admin-web|studio-web|marketing-web|release-center" >&2; exit 2;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BUN_VERSION="${BUN_VERSION:-1.2.15}"
if ! command -v bun >/dev/null 2>&1; then
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
bun --version | grep -Fx "$BUN_VERSION" >/dev/null || { echo "Expected Bun $BUN_VERSION" >&2; exit 3; }
bun install
bun run --filter @hendy/core-utils build
bun run --filter @hendy/ui-components build
bun run --filter "@hendy/${APP}" build
test -s "$ROOT/apps/$APP/dist/index.html"
printf 'Built %s into apps/%s/dist\n' "$APP" "$APP"
