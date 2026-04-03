#!/usr/bin/env bash
set -euo pipefail

readonly INSTALL_DIR="${HOME}/.claude/context-guard"
readonly SETTINGS_FILE="${HOME}/.claude/settings.json"

echo "Claude Context Guard — Uninstaller"
echo "===================================="

# 1. Remove hook from settings.json
if [[ -f "${SETTINGS_FILE}" ]] && command -v jq &>/dev/null; then
  echo "Removing hook from settings.json..."
  TEMP=$(mktemp)
  jq '
    if .hooks.PostToolUse then
      .hooks.PostToolUse |= map(select(.hooks | all(.command | test("context-guard") | not)))
    else . end
  ' "${SETTINGS_FILE}" > "${TEMP}" && mv "${TEMP}" "${SETTINGS_FILE}"
  echo "Hook removed."
fi

# 2. Remove source files (keep config and dumps)
echo "Removing source files..."
rm -rf "${INSTALL_DIR}/src" "${INSTALL_DIR}/package.json"

echo ""
echo "Uninstalled. Config and dumps preserved at ${INSTALL_DIR}/"
echo "To remove everything: rm -rf ${INSTALL_DIR}"
