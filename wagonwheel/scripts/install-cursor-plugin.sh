#!/usr/bin/env bash
# Copies cursor-plugin/ to Cursor's local plugin folder, so Cursor loads it as "wagonwheel".
# Run it again after any change to the plugin: it replaces the copy.
set -euo pipefail

src="$(cd "$(dirname "$0")/../cursor-plugin" && pwd)"
dest="${CURSOR_PLUGINS_DIR:-$HOME/.cursor/plugins/local}/wagonwheel"

[ -f "$src/.cursor-plugin/plugin.json" ] || { echo "No plugin manifest in $src" >&2; exit 1; }
mkdir -p "$dest"
rsync -a --delete "$src/" "$dest/"
echo "Installed to $dest"
echo "In Cursor: run \"Developer: Reload Window\" (or restart it). The server appears as plugin-wagonwheel-wagonwheel."
