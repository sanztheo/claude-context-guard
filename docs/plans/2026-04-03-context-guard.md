# Claude Context Guard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Open-source Claude Code hook that monitors context window % and API usage %, warns Claude when thresholds are exceeded, and auto-saves session state for seamless resume.

**Architecture:** A `PostToolUse` hook (Bun + TypeScript) that runs after every tool call. It parses the session transcript to compute context %, fetches API usage via OAuth (with file-based caching), and injects a warning into the conversation via `additionalContext` when configurable thresholds are crossed. On critical thresholds, it auto-generates a state dump file with session ID and resume instructions.

**Tech Stack:** Bun, TypeScript, macOS Keychain (OAuth token), Claude Code hooks API

---

## Project Structure

```
claude-context-guard/
├── README.md
├── LICENSE                     (MIT)
├── install.sh                  (one-command installer)
├── uninstall.sh
├── package.json
├── tsconfig.json
├── config.default.json
└── src/
    ├── guard.ts                (main hook entry point)
    ├── context.ts              (context % from transcript JSONL)
    ├── usage.ts                (OAuth API usage % with caching)
    ├── dump.ts                 (state dump generator)
    ├── config.ts               (config loader + validation)
    └── types.ts                (TypeScript interfaces)
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `config.default.json`
- Create: `src/types.ts`

**Step 1: Create package.json**

```json
{
  "name": "claude-context-guard",
  "version": "0.1.0",
  "description": "Claude Code hook that monitors context window and API usage, warns before limits, and auto-saves session state",
  "type": "module",
  "main": "src/guard.ts",
  "scripts": {
    "guard": "bun src/guard.ts",
    "test": "bun test"
  },
  "keywords": ["claude-code", "hook", "context-window", "usage-monitor"],
  "license": "MIT",
  "engines": {
    "bun": ">=1.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"]
}
```

**Step 3: Create config.default.json**

```json
{
  "context_warning_pct": 75,
  "context_critical_pct": 90,
  "usage_warning_pct": 70,
  "usage_critical_pct": 85,
  "check_usage_api": true,
  "cache_ttl_seconds": 120,
  "dump_dir": "~/.claude/context-guard/dumps",
  "enabled": true
}
```

**Step 4: Create src/types.ts**

```typescript
export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: Record<string, unknown>;
  model: {
    id: string;
    display_name: string;
  };
  workspace: {
    current_dir: string;
    project_dir: string;
  };
  version: string;
  cost: {
    total_cost_usd: number;
    total_duration_ms: number;
    total_api_duration_ms: number;
    total_lines_added: number;
    total_lines_removed: number;
  };
  exceeds_200k_tokens?: boolean;
}

export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

export interface GuardConfig {
  context_warning_pct: number;
  context_critical_pct: number;
  usage_warning_pct: number;
  usage_critical_pct: number;
  check_usage_api: boolean;
  cache_ttl_seconds: number;
  dump_dir: string;
  enabled: boolean;
}

export interface UsageData {
  five_hour: {
    utilization: number;
    resets_at: string;
    used?: number;
    limit?: number;
  };
  seven_day: {
    utilization: number;
    resets_at: string;
    used?: number;
    limit?: number;
  };
}

export interface UsageCache {
  data: UsageData;
  fetched_at: number;
}

export interface GuardState {
  context_pct: number;
  usage_5h_pct: number;
  usage_7d_pct: number;
  usage_resets_at: string;
  warnings: string[];
}
```

**Step 5: Commit**

```bash
git init && git add -A
git commit -m "feat: project scaffolding with types and config"
```

---

### Task 2: Context % Calculator

**Files:**
- Create: `src/context.ts`

**Step 1: Implement context percentage calculation**

Logic ported from the existing `statusline.rb:246-273` and `context.ts` in the statusline plugin. Reads the transcript JSONL, finds the most recent non-sidechain entry with usage data, computes `(input + cache_read + cache_creation) / 200,000 * 100`.

```typescript
import { existsSync } from "node:fs";

const MAX_CONTEXT_TOKENS = 200_000;

interface TokenUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface TranscriptEntry {
  message?: { usage?: TokenUsage };
  timestamp?: string;
  isSidechain?: boolean;
  isApiErrorMessage?: boolean;
}

export async function getContextPercentage(transcriptPath: string): Promise<number> {
  if (!transcriptPath || !existsSync(transcriptPath)) return 0;

  try {
    const content = await Bun.file(transcriptPath).text();
    const lines = content.trim().split("\n");

    let latestTokens = 0;
    let latestTime: Date | null = null;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry: TranscriptEntry = JSON.parse(line);
        if (entry.isSidechain || entry.isApiErrorMessage) continue;

        const usage = entry.message?.usage;
        if (!usage || !entry.timestamp) continue;

        const entryTime = new Date(entry.timestamp);
        if (!latestTime || entryTime > latestTime) {
          latestTime = entryTime;
          latestTokens =
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0);
        }
      } catch {
        continue;
      }
    }

    return Math.min(100, Math.round((latestTokens / MAX_CONTEXT_TOKENS) * 100));
  } catch {
    return 0;
  }
}
```

**Step 2: Manual test**

```bash
# Test with a real transcript if available
echo '{"message":{"usage":{"input_tokens":150000,"cache_read_input_tokens":10000,"cache_creation_input_tokens":5000}},"timestamp":"2026-04-03T12:00:00Z"}' > /tmp/test-transcript.jsonl
bun -e "import {getContextPercentage} from './src/context.ts'; console.log(await getContextPercentage('/tmp/test-transcript.jsonl'))"
# Expected: 83 (165000/200000 = 82.5% → 83)
```

**Step 3: Commit**

```bash
git add src/context.ts && git commit -m "feat: context window percentage calculator from transcript"
```

---

### Task 3: OAuth Usage Fetcher with Caching

**Files:**
- Create: `src/usage.ts`

**Step 1: Implement usage fetcher with file-based cache**

Ported from `statusline.rb:693-716`. Fetches from `api.anthropic.com/api/oauth/usage` using OAuth token from macOS Keychain. Caches result to `/tmp/claude-context-guard-cache.json` to avoid hammering the API on every tool call.

```typescript
import type { UsageData, UsageCache } from "./types.ts";

const CACHE_PATH = "/tmp/claude-context-guard-cache.json";
const KEYCHAIN_SERVICE = "Claude Code-credentials";

async function getOAuthToken(): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0 || !output.trim()) return null;

    const data = JSON.parse(output.trim());
    return data?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

async function readCache(ttlSeconds: number): Promise<UsageData | null> {
  try {
    const file = Bun.file(CACHE_PATH);
    if (!(await file.exists())) return null;

    const cache: UsageCache = JSON.parse(await file.text());
    const age = (Date.now() - cache.fetched_at) / 1000;
    if (age > ttlSeconds) return null;

    return cache.data;
  } catch {
    return null;
  }
}

async function writeCache(data: UsageData): Promise<void> {
  const cache: UsageCache = { data, fetched_at: Date.now() };
  await Bun.write(CACHE_PATH, JSON.stringify(cache));
}

export async function getUsageData(cacheTtlSeconds: number): Promise<UsageData | null> {
  // Try cache first
  const cached = await readCache(cacheTtlSeconds);
  if (cached) return cached;

  // Fetch from API
  const token = await getOAuthToken();
  if (!token) return null;

  try {
    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data: UsageData = await response.json();
    await writeCache(data);
    return data;
  } catch {
    return null;
  }
}
```

**Step 2: Manual test**

```bash
bun -e "import {getUsageData} from './src/usage.ts'; console.log(JSON.stringify(await getUsageData(120), null, 2))"
# Expected: JSON with five_hour.utilization and seven_day.utilization
```

**Step 3: Commit**

```bash
git add src/usage.ts && git commit -m "feat: OAuth usage fetcher with file-based cache"
```

---

### Task 4: State Dump Generator

**Files:**
- Create: `src/dump.ts`

**Step 1: Implement state dump**

Parses the transcript to extract recent user messages, files touched, and recent actions. Writes a markdown file with session ID and resume instructions.

```typescript
import type { HookInput, GuardConfig } from "./types.ts";
import { existsSync, mkdirSync } from "node:fs";

interface TranscriptSummary {
  recent_messages: string[];
  files_touched: string[];
  recent_actions: string[];
}

function expandPath(p: string): string {
  return p.replace(/^~/, process.env.HOME ?? "~");
}

async function extractTranscriptSummary(transcriptPath: string): Promise<TranscriptSummary> {
  const summary: TranscriptSummary = {
    recent_messages: [],
    files_touched: [],
    recent_actions: [],
  };

  if (!transcriptPath || !existsSync(transcriptPath)) return summary;

  try {
    const content = await Bun.file(transcriptPath).text();
    const lines = content.trim().split("\n");
    const filesSet = new Set<string>();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);

        // User messages
        if (entry.type === "human") {
          const content = entry.message?.content;
          if (typeof content === "string" && content.trim()) {
            summary.recent_messages.push(content.trim().slice(0, 200));
          } else if (Array.isArray(content)) {
            for (const part of content) {
              if (part?.type === "text" && part.text?.trim()) {
                summary.recent_messages.push(part.text.trim().slice(0, 200));
              }
            }
          }
        }

        // Tool uses
        if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
          for (const part of entry.message.content) {
            if (part?.type !== "tool_use") continue;
            const input = part.input ?? {};
            if (input.file_path) filesSet.add(input.file_path);
            const name = part.name ?? "";
            if (["Edit", "Write", "Bash"].includes(name)) {
              const desc = input.description ?? input.command ?? name;
              summary.recent_actions.push(`${name}: ${String(desc).slice(0, 100)}`);
            }
          }
        }
      } catch {
        continue;
      }
    }

    summary.files_touched = [...filesSet].slice(-15);
    summary.recent_messages = summary.recent_messages.slice(-5);
    summary.recent_actions = summary.recent_actions.slice(-10);
  } catch {
    // Silent fail
  }

  return summary;
}

export async function createStateDump(
  hookInput: HookInput,
  config: GuardConfig,
  contextPct: number,
  usagePct: number,
  trigger: string
): Promise<string> {
  const dumpDir = expandPath(config.dump_dir);
  if (!existsSync(dumpDir)) mkdirSync(dumpDir, { recursive: true });

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dumpPath = `${dumpDir}/${timestamp}.md`;

  const summary = await extractTranscriptSummary(hookInput.transcript_path);

  const content = `# Context Guard — State Dump

**Session ID:** \`${hookInput.session_id}\`
**Date:** ${now.toISOString()}
**Trigger:** ${trigger}
**Model:** ${hookInput.model?.display_name ?? "unknown"}
**Context:** ${contextPct}% | **Usage 5h:** ${usagePct}%
**Working directory:** ${hookInput.cwd}

## Resume

\`\`\`bash
claude -r ${hookInput.session_id}
\`\`\`

Then tell Claude: "Read ${dumpPath} and continue where we left off."

## Recent User Messages
${summary.recent_messages.map((m, i) => `${i + 1}. ${m}`).join("\n") || "(none)"}

## Files Touched
${summary.files_touched.map((f) => `- ${f}`).join("\n") || "(none)"}

## Recent Actions
${summary.recent_actions.map((a) => `- ${a}`).join("\n") || "(none)"}

## Next Steps
_(Fill this section before compacting if possible)_
`;

  await Bun.write(dumpPath, content);
  return dumpPath;
}
```

**Step 2: Commit**

```bash
git add src/dump.ts && git commit -m "feat: state dump generator with transcript summary"
```

---

### Task 5: Config Loader

**Files:**
- Create: `src/config.ts`

**Step 1: Implement config loader with defaults**

```typescript
import type { GuardConfig } from "./types.ts";
import { existsSync } from "node:fs";

const CONFIG_PATH = `${process.env.HOME}/.claude/context-guard/config.json`;

const DEFAULTS: GuardConfig = {
  context_warning_pct: 75,
  context_critical_pct: 90,
  usage_warning_pct: 70,
  usage_critical_pct: 85,
  check_usage_api: true,
  cache_ttl_seconds: 120,
  dump_dir: "~/.claude/context-guard/dumps",
  enabled: true,
};

export async function loadConfig(): Promise<GuardConfig> {
  if (!existsSync(CONFIG_PATH)) return DEFAULTS;

  try {
    const raw = JSON.parse(await Bun.file(CONFIG_PATH).text());
    return { ...DEFAULTS, ...raw };
  } catch {
    return DEFAULTS;
  }
}
```

**Step 2: Commit**

```bash
git add src/config.ts && git commit -m "feat: config loader with sensible defaults"
```

---

### Task 6: Main Guard Hook

**Files:**
- Create: `src/guard.ts`

**Step 1: Implement the main hook entry point**

This is the core — ties everything together. Runs on every PostToolUse, checks thresholds, generates warnings.

```typescript
import type { HookInput, HookOutput, GuardState } from "./types.ts";
import { getContextPercentage } from "./context.ts";
import { getUsageData } from "./usage.ts";
import { createStateDump } from "./dump.ts";
import { loadConfig } from "./config.ts";

// Track if we already warned this session (avoid spam)
const WARN_STATE_PATH = "/tmp/claude-context-guard-warned.json";

interface WarnState {
  session_id: string;
  context_warned: boolean;
  context_critical: boolean;
  usage_warned: boolean;
  usage_critical: boolean;
}

async function getWarnState(sessionId: string): Promise<WarnState> {
  try {
    const file = Bun.file(WARN_STATE_PATH);
    if (!(await file.exists())) throw new Error("no file");
    const state: WarnState = JSON.parse(await file.text());
    if (state.session_id !== sessionId) throw new Error("different session");
    return state;
  } catch {
    return {
      session_id: sessionId,
      context_warned: false,
      context_critical: false,
      usage_warned: false,
      usage_critical: false,
    };
  }
}

async function saveWarnState(state: WarnState): Promise<void> {
  await Bun.write(WARN_STATE_PATH, JSON.stringify(state));
}

function formatTimeUntil(isoDate: string): string {
  const diff = Math.max(0, new Date(isoDate).getTime() - Date.now());
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}

async function main(): Promise<void> {
  const config = await loadConfig();
  if (!config.enabled) return;

  const input: HookInput = JSON.parse(await Bun.stdin.text());
  const sessionId = input.session_id;
  const warnState = await getWarnState(sessionId);

  // 1. Check context %
  const contextPct = await getContextPercentage(input.transcript_path);

  // 2. Check usage % (with caching)
  let usagePct = 0;
  let usageResetTime = "";
  if (config.check_usage_api) {
    const usage = await getUsageData(config.cache_ttl_seconds);
    if (usage) {
      usagePct = Math.round(usage.five_hour.utilization);
      usageResetTime = formatTimeUntil(usage.five_hour.resets_at);
    }
  }

  // 3. Build warnings
  const warnings: string[] = [];
  let needsDump = false;

  // Context warnings
  if (contextPct >= config.context_critical_pct && !warnState.context_critical) {
    warnings.push(
      `[CONTEXT GUARD - CRITICAL] Context window at ${contextPct}%. ` +
      `Compaction is imminent. Save your current state NOW, then use /compact.`
    );
    warnState.context_critical = true;
    warnState.context_warned = true;
    needsDump = true;
  } else if (contextPct >= config.context_warning_pct && !warnState.context_warned) {
    warnings.push(
      `[CONTEXT GUARD - WARNING] Context window at ${contextPct}%. ` +
      `Consider wrapping up the current task. A state dump will be saved at ${config.context_critical_pct}%.`
    );
    warnState.context_warned = true;
  }

  // Usage warnings
  if (usagePct >= config.usage_critical_pct && !warnState.usage_critical) {
    warnings.push(
      `[CONTEXT GUARD - USAGE CRITICAL] API usage at ${usagePct}% (resets in ${usageResetTime}). ` +
      `You may hit rate limits soon. Consider pausing or switching to a lighter model.`
    );
    warnState.usage_critical = true;
    warnState.usage_warned = true;
    needsDump = true;
  } else if (usagePct >= config.usage_warning_pct && !warnState.usage_warned) {
    warnings.push(
      `[CONTEXT GUARD - USAGE WARNING] API usage at ${usagePct}% (resets in ${usageResetTime}). ` +
      `Monitor your usage — limit approaching.`
    );
    warnState.usage_warned = true;
  }

  // 4. Auto-dump on critical
  if (needsDump) {
    const trigger = contextPct >= config.context_critical_pct
      ? `context at ${contextPct}%`
      : `usage at ${usagePct}%`;
    const dumpPath = await createStateDump(input, config, contextPct, usagePct, trigger);
    warnings.push(
      `State dump saved to: ${dumpPath}\n` +
      `Session ID: ${sessionId}\n` +
      `Resume: claude -r ${sessionId}`
    );
  }

  // 5. Save warn state
  await saveWarnState(warnState);

  // 6. Output additionalContext if warnings
  if (warnings.length > 0) {
    const output: HookOutput = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: warnings.join("\n\n"),
      },
    };
    console.log(JSON.stringify(output));
  }
}

main().catch(() => process.exit(0));
```

**Step 2: Test manually with mock stdin**

```bash
echo '{"session_id":"test-123","transcript_path":"/tmp/test-transcript.jsonl","cwd":"/tmp","hook_event_name":"PostToolUse","tool_name":"Read","tool_input":{},"tool_response":{},"model":{"id":"opus","display_name":"Claude Opus 4.6"},"workspace":{"current_dir":"/tmp","project_dir":"/tmp"},"version":"1.0","cost":{"total_cost_usd":0,"total_duration_ms":0,"total_api_duration_ms":0,"total_lines_added":0,"total_lines_removed":0}}' | bun src/guard.ts
```

**Step 3: Commit**

```bash
git add src/guard.ts && git commit -m "feat: main guard hook with threshold detection and auto-dump"
```

---

### Task 7: Installer & Uninstaller

**Files:**
- Create: `install.sh`
- Create: `uninstall.sh`

**Step 1: Create install.sh**

The installer:
1. Copies the project to `~/.claude/context-guard/`
2. Creates default config
3. Adds the PostToolUse hook to `~/.claude/settings.json`
4. Creates dumps directory

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${HOME}/.claude/context-guard"
CONFIG_DIR="${HOME}/.claude/context-guard"
DUMPS_DIR="${HOME}/.claude/context-guard/dumps"
SETTINGS_FILE="${HOME}/.claude/settings.json"
HOOK_COMMAND="bun ${INSTALL_DIR}/src/guard.ts"

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
mkdir -p "${INSTALL_DIR}/src" "${DUMPS_DIR}"

cp src/guard.ts src/context.ts src/usage.ts src/dump.ts src/config.ts src/types.ts "${INSTALL_DIR}/src/"
cp package.json "${INSTALL_DIR}/"

# 3. Create config if not exists
if [[ ! -f "${CONFIG_DIR}/config.json" ]]; then
  cp config.default.json "${CONFIG_DIR}/config.json"
  echo "Created config at ${CONFIG_DIR}/config.json"
else
  echo "Config already exists, skipping."
fi

# 4. Add hook to settings.json
if [[ ! -f "${SETTINGS_FILE}" ]]; then
  echo '{}' > "${SETTINGS_FILE}"
fi

# Check if hook already exists
if jq -e '.hooks.PostToolUse[]? | select(.hooks[]?.command | test("context-guard"))' "${SETTINGS_FILE}" &>/dev/null; then
  echo "Hook already registered in settings.json, skipping."
else
  echo "Adding PostToolUse hook to settings.json..."

  # Create the hook entry
  HOOK_ENTRY=$(jq -n --arg cmd "${HOOK_COMMAND}" '{
    "hooks": [
      {
        "type": "command",
        "command": $cmd,
        "timeout": 5000
      }
    ]
  }')

  # Add to PostToolUse array (create if needed)
  TEMP=$(mktemp)
  jq --argjson entry "${HOOK_ENTRY}" '
    .hooks //= {} |
    .hooks.PostToolUse //= [] |
    .hooks.PostToolUse += [$entry]
  ' "${SETTINGS_FILE}" > "${TEMP}" && mv "${TEMP}" "${SETTINGS_FILE}"

  echo "Hook registered."
fi

echo ""
echo "Installation complete!"
echo ""
echo "Config: ${CONFIG_DIR}/config.json"
echo "Dumps:  ${DUMPS_DIR}/"
echo ""
echo "Edit config.json to adjust thresholds."
echo "Restart Claude Code to activate."
```

**Step 2: Create uninstall.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${HOME}/.claude/context-guard"
SETTINGS_FILE="${HOME}/.claude/settings.json"

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
```

**Step 3: Make executable and commit**

```bash
chmod +x install.sh uninstall.sh
git add install.sh uninstall.sh && git commit -m "feat: install and uninstall scripts"
```

---

### Task 8: README

**Files:**
- Create: `README.md`
- Create: `LICENSE`

**Step 1: Write README.md**

Must include:
- What it does (with screenshot/demo of the warning message)
- Requirements (Bun, jq, macOS, Claude Code)
- One-command install
- Configuration reference
- How it works (architecture diagram)
- How to resume a session
- Uninstall instructions
- Contributing section

**Step 2: Write MIT LICENSE**

**Step 3: Commit**

```bash
git add README.md LICENSE && git commit -m "docs: README with install guide and configuration reference"
```

---

### Task 9: End-to-End Test

**Step 1: Test the full flow**

1. Create a fake transcript with high token count (>75% of 200K)
2. Run `guard.ts` with mock stdin
3. Verify it outputs the correct `additionalContext` JSON
4. Verify the dump file was created
5. Verify the warn state prevents duplicate warnings

```bash
# Create test transcript at 80%
echo '{"type":"assistant","message":{"usage":{"input_tokens":160000,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}},"timestamp":"2026-04-03T12:00:00Z"}' > /tmp/test-guard-transcript.jsonl

# Run guard
echo '{"session_id":"test-e2e","transcript_path":"/tmp/test-guard-transcript.jsonl","cwd":"/tmp","hook_event_name":"PostToolUse","tool_name":"Read","tool_input":{},"tool_response":{},"model":{"id":"opus","display_name":"Opus 4.6"},"workspace":{"current_dir":"/tmp","project_dir":"/tmp"},"version":"1.0","cost":{"total_cost_usd":0,"total_duration_ms":0,"total_api_duration_ms":0,"total_lines_added":0,"total_lines_removed":0}}' | bun src/guard.ts

# Expected: JSON output with warning about context at 80%
# Expected: NO dump file (warning threshold, not critical)

# Run again — should NOT warn twice
echo '...' | bun src/guard.ts
# Expected: no output (already warned for this session)
```

**Step 2: Test critical threshold**

```bash
# Create test transcript at 95%
echo '{"type":"assistant","message":{"usage":{"input_tokens":190000,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}},"timestamp":"2026-04-03T12:00:00Z"}' > /tmp/test-guard-transcript.jsonl

# Reset warn state
rm -f /tmp/claude-context-guard-warned.json

echo '...' | bun src/guard.ts
# Expected: CRITICAL warning + dump file created in ~/.claude/context-guard/dumps/
```

**Step 3: Commit any test fixes**

```bash
git add -A && git commit -m "test: end-to-end verification"
```

---

### Task 10: Install and Verify in Real Environment

**Step 1: Run installer**

```bash
cd ~/claude-context-guard && bash install.sh
```

**Step 2: Verify settings.json has the hook**

```bash
jq '.hooks.PostToolUse' ~/.claude/settings.json
```

**Step 3: Restart Claude Code and verify hook runs silently on normal usage**

**Step 4: Final commit and push**

```bash
git add -A && git commit -m "chore: ready for v0.1.0 release"
```

---

## Execution Notes

- **Performance budget**: The hook must complete in <100ms on normal calls (no warning). Context parsing is ~10ms, cached API check is ~1ms, uncached API is ~200ms but happens max once per 2 minutes.
- **Fail-safe**: Every function has try/catch that exits silently. The hook must NEVER crash Claude Code.
- **Dedup**: Warn state file per session prevents message spam. Each threshold level warns exactly once.
- **macOS only**: Keychain access for OAuth token. Linux support would need a different credential store (future PR).
