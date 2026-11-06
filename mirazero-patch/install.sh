#!/usr/bin/env bash
#
# Install the DSH provider patch into a MiraZero checkout and rebuild it.
#
#   ./install.sh /opt/mirazero
#   ./install.sh /opt/mirazero --restart
#
# The service is not stopped automatically: stop it first if your unit holds
# the old .output files, or pass --restart to restart mirazero after a
# successful build.
set -euo pipefail

REPO_DIR="${1:-/opt/mirazero}"
RESTART="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/server/api/plugin/dsh"
DEST="$REPO_DIR/server/api/plugin/dsh"

if [[ ! -f "$REPO_DIR/package.json" || ! -d "$REPO_DIR/server" ]]; then
  echo "Not a MiraZero checkout: $REPO_DIR" >&2
  echo "Usage: $0 /path/to/mirazero [--restart]" >&2
  exit 1
fi

if [[ ! -d "$SRC" ]]; then
  echo "Patch directory is missing: $SRC" >&2
  exit 1
fi

command -v pnpm >/dev/null 2>&1 || {
  echo "pnpm is required (pnpm 10+)" >&2
  exit 1
}

echo "==> Copying provider patch into $DEST"
mkdir -p "$DEST"
cp -a "$SRC/." "$DEST/"

echo "==> Installing dependencies"
cd "$REPO_DIR"
pnpm install --frozen-lockfile

echo "==> Rebuilding better-sqlite3 for the current Node"
npm_config_build_from_source=true pnpm rebuild better-sqlite3

echo "==> Building MiraZero"
pnpm run build

echo
echo "Patch installed. Files:"
ls -1 "$DEST"
echo
echo "Verify with:"
echo "  curl -H 'Authorization: Bearer mzi_...' https://你的站点/api/plugin/dsh/status"
echo
echo "Restart the service:"
echo "  sudo systemctl restart mirazero"
echo "or:"
echo "  pm2 restart mirazero"

if [[ "$RESTART" == "--restart" ]]; then
  echo "==> Restarting mirazero"
  sudo systemctl restart mirazero
fi
