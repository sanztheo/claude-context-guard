#!/usr/bin/env bash
set -euo pipefail

readonly INSTALL_DIR="${HOME}/.claude/context-guard"
readonly SETTINGS_FILE="${HOME}/.claude/settings.json"
readonly COMMANDS_DIR="${HOME}/.claude/commands"
readonly HOOK_COMMAND="bun ${INSTALL_DIR}/src/guard.ts"

echo "Claude Context Guard — Installer"
echo "================================="

# 1. Check dependencies
if ! command -v bun &>/dev/null; then
  echo "Error: bun is required. Install it: https://bun.sh"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install it: brew install jq"
  exit 1
fi

# 2. Copy source files
echo "Installing to ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}/src" "${COMMANDS_DIR}"

cp src/guard.ts src/context.ts src/usage.ts src/dump.ts src/config.ts src/types.ts "${INSTALL_DIR}/src/"
cp package.json "${INSTALL_DIR}/"

# 3. Install skills (slash commands)
echo "Installing skills to ${COMMANDS_DIR}..."
cp skills/save-session.md skills/save-compact.md "${COMMANDS_DIR}/"

# 4. Create config if not exists
if [[ ! -f "${INSTALL_DIR}/config.json" ]]; then
  cp config.default.json "${INSTALL_DIR}/config.json"
  echo "Created config at ${INSTALL_DIR}/config.json"
else
  echo "Config already exists, skipping."
fi

# 5. Add hook to settings.json
if [[ ! -f "${SETTINGS_FILE}" ]]; then
  echo '{}' > "${SETTINGS_FILE}"
fi

if jq -e '.hooks.PostToolUse[]? | select(.hooks[]?.command | test("context-guard"))' "${SETTINGS_FILE}" &>/dev/null; then
  echo "Hook already registered in settings.json, skipping."
else
  echo "Adding PostToolUse hook to settings.json..."
  HOOK_ENTRY=$(jq -n --arg cmd "${HOOK_COMMAND}" '{
    "hooks": [
      {
        "type": "command",
        "command": $cmd,
        "timeout": 5000
      }
    ]
  }')
  TEMP=$(mktemp)
  jq --argjson entry "${HOOK_ENTRY}" '
    .hooks //= {} |
    .hooks.PostToolUse //= [] |
    .hooks.PostToolUse += [$entry]
  ' "${SETTINGS_FILE}" > "${TEMP}" && mv "${TEMP}" "${SETTINGS_FILE}"
  echo "Hook registered."
fi

# 6. Add SessionStart hook (checks usage/context on launch)
if jq -e '.hooks.SessionStart[]? | select(.hooks[]?.command | test("context-guard"))' "${SETTINGS_FILE}" &>/dev/null; then
  echo "SessionStart hook already registered, skipping."
else
  echo "Adding SessionStart hook to settings.json..."
  SESSION_HOOK=$(jq -n --arg cmd "${HOOK_COMMAND}" '{
    "hooks": [
      {
        "type": "command",
        "command": $cmd,
        "timeout": 5000
      }
    ]
  }')
  TEMP=$(mktemp)
  jq --argjson entry "${SESSION_HOOK}" '
    .hooks //= {} |
    .hooks.SessionStart //= [] |
    .hooks.SessionStart += [$entry]
  ' "${SETTINGS_FILE}" > "${TEMP}" && mv "${TEMP}" "${SETTINGS_FILE}"
  echo "SessionStart hook registered."
fi

echo ""
echo "Installation complete!"
echo ""
echo "Config:  ${INSTALL_DIR}/config.json"
echo "Skills:  /save-session, /save-compact"
echo ""
echo "Edit config.json to adjust thresholds."
echo "Restart Claude Code to activate."
