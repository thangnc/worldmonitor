#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit): refuse hand-edits to generated files.
# Exit 2 blocks the tool call and shows stderr to Claude.
file=$(jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0

case "$file" in
  */src/generated/*)
    echo "Blocked: $file is generated from proto/. Edit the .proto definition and run 'make generate' instead (see CLAUDE.md)." >&2
    exit 2 ;;
  */docs/api/*)
    echo "Blocked: $file is OpenAPI generated from proto/. Edit the .proto definition and run 'make generate' instead (see CLAUDE.md)." >&2
    exit 2 ;;
  */docs/engineering/solutions/INDEX.md|*/docs/engineering/plans/INDEX.md)
    echo "Blocked: $file is generated from lesson and plan frontmatter. Edit the records and run 'npm run generate' instead (see docs/engineering/solutions/README.md)." >&2
    exit 2 ;;
  */package-lock.json)
    echo "Blocked: package-lock.json is managed by npm. Change package.json and run 'npm install' instead." >&2
    exit 2 ;;
esac
exit 0
