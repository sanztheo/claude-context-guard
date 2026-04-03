# claude-context-guard

A Claude Code hook that monitors your context window and API usage in real-time. Warns you before you hit limits, and auto-saves session state so you can resume seamlessly.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What it does

- **Monitors context window** — tracks token usage as a percentage of the 200K context limit
- **Monitors API quota** — checks your 5-hour usage window via the Anthropic OAuth API
- **Warns at configurable thresholds** — warning level (75%) and critical level (90%)
- **Auto-saves state dumps** — on critical thresholds, saves session ID, files touched, and resume instructions
- **No spam** — each threshold warns exactly once per session

## How it works

```
Claude Code
    |
    +--> PostToolUse hook (runs after every tool call)
         |
         +--> Parse transcript JSONL --> context %
         +--> Fetch OAuth API (cached) --> usage %
         |
         +--> Threshold exceeded?
              |
              YES --> Inject warning via additionalContext
              |       (Claude sees it as a system message)
              |
              CRITICAL --> Auto-save state dump + warn
```

The hook reads Claude Code's session transcript to calculate context usage, and queries `api.anthropic.com/api/oauth/usage` for your API quota (cached for 2 minutes to avoid overhead). When thresholds are crossed, it injects a warning directly into the conversation — Claude receives it and can act on it.

## Requirements

- **macOS** (uses Keychain for OAuth token)
- **Bun** >= 1.0 ([install](https://bun.sh))
- **jq** (`brew install jq`)
- **Claude Code**

## Installation

```bash
git clone https://github.com/theo-sanz/claude-context-guard.git
cd claude-context-guard
bash install.sh
```

Then restart Claude Code.

The installer:
1. Copies source to `~/.claude/context-guard/`
2. Creates default config at `~/.claude/context-guard/config.json`
3. Registers a `PostToolUse` hook in `~/.claude/settings.json`

## Configuration

Edit `~/.claude/context-guard/config.json`:

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

| Field | Description |
|---|---|
| `context_warning_pct` | Context window % to trigger a warning (default: 75) |
| `context_critical_pct` | Context window % to trigger critical alert + state dump (default: 90) |
| `usage_warning_pct` | API usage % to trigger a warning (default: 70) |
| `usage_critical_pct` | API usage % to trigger critical alert + state dump (default: 85) |
| `check_usage_api` | Enable/disable API usage monitoring (default: true) |
| `cache_ttl_seconds` | How long to cache API usage responses (default: 120) |
| `dump_dir` | Where to save state dumps (default: ~/.claude/context-guard/dumps) |
| `enabled` | Kill switch (default: true) |

## Warning messages

When thresholds are crossed, Claude receives messages like:

**Context warning (75%):**
```
[CONTEXT GUARD - WARNING] Context window at 78%.
Consider wrapping up the current task. A state dump will be saved at 90%.
```

**Context critical (90%):**
```
[CONTEXT GUARD - CRITICAL] Context window at 92%.
Compaction is imminent. Save your current state NOW, then use /compact.
```

**Usage warning (70%):**
```
[CONTEXT GUARD - USAGE WARNING] API usage at 72% (resets in 2h14m).
Monitor your usage — limit approaching.
```

## State dumps

On critical thresholds, a markdown file is automatically saved with:

- Session ID and resume command
- Recent user messages
- Files touched during the session
- Recent tool actions
- A "Next Steps" placeholder

Example dump at `~/.claude/context-guard/dumps/2026-04-03T14-30-00.md`.

## Resuming a session

```bash
claude -r <session_id>
```

Then tell Claude:
> Read ~/.claude/context-guard/dumps/<timestamp>.md and continue where we left off.

## Performance

The hook runs in under 50ms per tool call:
- Transcript parsing: ~10ms
- Cached API check: ~1ms (uncached: ~200ms, max once per 2 min)
- File I/O for warn state: ~1ms

## How it's built

~250 lines of TypeScript, zero dependencies beyond Bun. Six modules:

| Module | Purpose |
|---|---|
| `guard.ts` | Main entry point — threshold logic and warning generation |
| `context.ts` | Context % calculator from transcript JSONL |
| `usage.ts` | OAuth API usage fetcher with file-based caching |
| `dump.ts` | State dump generator with transcript summary |
| `config.ts` | Config loader with sensible defaults |
| `types.ts` | TypeScript interfaces |

## Uninstall

```bash
cd claude-context-guard
bash uninstall.sh
```

Removes the hook and source files. Config and dumps are preserved at `~/.claude/context-guard/`.

To remove everything:
```bash
rm -rf ~/.claude/context-guard
```

## License

MIT
