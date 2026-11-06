#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): Biome-lint the edited JS/TS file.
# Exit 2 feeds lint diagnostics back to Claude; any other outcome is silent.
file=$(jq -r '.tool_input.file_path // empty')
case "$file" in
  *.ts|*.mts|*.cts|*.js|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null)}"
biome="$root/node_modules/.bin/biome"
# Skip quietly when dependencies are not installed (no network fetch via npx).
[ -x "$biome" ] || exit 0

if ! out=$(cd "$root" && "$biome" lint --no-errors-on-unmatched --colors=off "$file" 2>&1); then
  printf 'Biome lint failed for %s:\n%s\n' "$file" "$out" >&2
  exit 2
fi
exit 0
