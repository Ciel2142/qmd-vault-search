#!/usr/bin/env bash
#
# install-macos.sh — Build and install the "qmd Search" plugin into an Obsidian vault (macOS).
#
# Usage:
#   ./install-macos.sh ["/path/to/your/vault"]
#
# If no path is given, the script reads the current user's Obsidian vault list from
#   ~/Library/Application Support/obsidian/obsidian.json
# and uses it when there is exactly one vault. Otherwise it asks you to pass the path.
#
# You can also point it with an env var:
#   OBSIDIAN_VAULT="/path/to/your/vault" ./install-macos.sh
#
set -euo pipefail

PLUGIN_ID="qmd-vault-search"
ARTIFACTS=(main.js manifest.json styles.css)

# Always operate from the repo root (this script's own directory).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OBSIDIAN_JSON="$HOME/Library/Application Support/obsidian/obsidian.json"

resolve_vault() {
  # Priority: explicit arg, then $OBSIDIAN_VAULT, then auto-detect from obsidian.json.
  local v="${1:-${OBSIDIAN_VAULT:-}}"
  if [ -n "$v" ]; then printf '%s\n' "$v"; return 0; fi

  if [ ! -f "$OBSIDIAN_JSON" ]; then
    echo "No vault path given, and $OBSIDIAN_JSON was not found." >&2
    echo "Run: ./install-macos.sh \"/path/to/your/vault\"" >&2
    return 1
  fi

  # Pull every "path":"..." value out of obsidian.json (BSD grep/sed — no jq needed).
  local paths count
  paths="$(grep -o '"path":"[^"]*"' "$OBSIDIAN_JSON" | sed -e 's/^"path":"//' -e 's/"$//')"
  count="$(printf '%s' "$paths" | grep -c . || true)"

  if [ "$count" = "1" ]; then printf '%s\n' "$paths"; return 0; fi

  echo "Couldn't pick a vault automatically. Re-run with an explicit path:" >&2
  echo "  ./install-macos.sh \"/path/to/your/vault\"" >&2
  if [ "$count" != "0" ]; then
    echo "Vaults Obsidian knows about:" >&2
    while IFS= read -r p; do [ -n "$p" ] && echo "  $p" >&2; done <<< "$paths"
  fi
  return 1
}

VAULT="$(resolve_vault "${1:-}")"
VAULT="${VAULT/#\~/$HOME}"   # expand a leading ~

if [ ! -d "$VAULT/.obsidian" ]; then
  echo "Error: '$VAULT' is not an Obsidian vault (.obsidian/ is missing)." >&2
  exit 1
fi

# Build main.js if it hasn't been built yet (needs Node.js 18+).
if [ ! -f main.js ]; then
  echo "main.js not found — building (npm install && npm run build)..."
  npm install
  npm run build
fi

DEST="$VAULT/.obsidian/plugins/$PLUGIN_ID"
mkdir -p "$DEST"
for f in "${ARTIFACTS[@]}"; do
  if [ ! -f "$f" ]; then
    echo "Error: build artifact '$f' is missing. Run 'npm run build' first." >&2
    exit 1
  fi
  cp "$f" "$DEST/"
done

echo "Installed '$PLUGIN_ID' -> $DEST"
echo "Reload Obsidian, then enable 'qmd Vault Search' under Settings -> Community plugins."
