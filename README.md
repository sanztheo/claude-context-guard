# claude-context-guard

A Claude Code hook that monitors your context window and API usage in real-time. Warns you before you hit limits, and helps you save session state so you can resume seamlessly.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What it does

- **Monitors context window** — tracks token usage as a percentage of the 200K context limit
- **Monitors API quota** — checks your 5-hour and 7-day usage windows via the Anthropic OAuth API
- **Warns at configurable thresholds** — warning (75%) and critical (90%) levels
- **On critical** — instructs Claude to write a detailed state file so you can resume after `/compact` or in a new session
- **Slash commands** — `/save-session` and `/save-compact` to manually save state anytime
- **No spam** — each threshold warns exactly once per session

## How it works

```
Claude Code
    |
    +--> PostToolUse hook (runs after every tool call)
    +--> SessionStart hook (runs when a session starts)
         |
         +--> Parse transcript JSONL --> context %
         +--> Fetch OAuth API (cached) --> usage %
         |
         +--> SessionStart? --> Inject compact briefing: [CG] ctx:52% · 5h:23% · 7d:11%
         |
         +--> Threshold exceeded?
              |
              WARNING  --> [CG] WARNING ctx:78% — wrap up soon
              CRITICAL --> [CG] CRITICAL ctx:92% — Claude writes state file
```

State files are saved in your **project directory** at `.context-guard/state.md` — not in a global folder. This means each project has its own state dump, and it stays close to your code.

## Requirements

- **macOS** (uses Keychain for OAuth token)
- **Bun** >= 1.0 ([install](https://bun.sh))
- **jq** (`brew install jq`)
- **Claude Code**

## Installation

```bash
git clone https://github.com/sanztheo/claude-context-guard.git
cd claude-context-guard
bash install.sh
```

Then restart Claude Code.

The installer:
1. Copies source to `~/.claude/context-guard/`
2. Installs `/save-session` and `/save-compact` skills to `~/.claude/commands/`
3. Creates default config at `~/.claude/context-guard/config.json`
4. Registers `PostToolUse` and `SessionStart` hooks in `~/.claude/settings.json`

## Slash commands

| Command | When to use |
|---|---|
| `/save-session` | Before starting a new Claude session — saves state with session ID and resume instructions |
| `/save-compact` | Before running `/compact` — saves state so Claude can recover context after compaction |

Both write a detailed state file to `.context-guard/state.md` in your project directory, including:
- Session ID and resume command
- Summary of everything done
- Current status and blockers
- Files modified
- Exact next steps

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
  "enabled": true
}
```

| Field | Description |
|---|---|
| `context_warning_pct` | Context window % to trigger a warning (default: 75) |
| `context_critical_pct` | Context window % to trigger critical + state save (default: 90) |
| `usage_warning_pct` | API usage % to trigger a warning (default: 70) |
| `usage_critical_pct` | API usage % to trigger critical + state save (default: 85) |
| `check_usage_api` | Enable/disable API usage monitoring (default: true) |
| `cache_ttl_seconds` | How long to cache API usage responses (default: 120) |
| `enabled` | Kill switch (default: true) |

## Resuming after state save

After `/save-compact`:
```
/compact
# Then tell Claude:
Read .context-guard/state.md to continue.
```

After `/save-session`:
```bash
# Resume the same session:
claude -r <session_id>
# Or start fresh:
claude
# Then tell Claude:
Read .context-guard/state.md to continue.
```

## Performance

The hook runs in under 50ms per tool call:
- Transcript parsing: ~10ms
- Cached API check: ~1ms (uncached: ~200ms, max once per 2 min)
- File I/O for warn state: ~1ms

## How it's built

~250 lines of TypeScript, zero dependencies beyond Bun. Six modules:

| Module | Purpose |
|---|---|
| `guard.ts` | Main entry point — threshold logic and warning injection |
| `context.ts` | Context % calculator from transcript JSONL |
| `usage.ts` | OAuth API usage fetcher with file-based caching |
| `config.ts` | Config loader with sensible defaults |
| `types.ts` | TypeScript interfaces |
| `dump.ts` | Transcript parser (kept for reference) |

## .gitignore

Add `.context-guard/` to your project's `.gitignore` — state dumps are local, not meant to be committed:

```
echo ".context-guard/" >> .gitignore
```

## Uninstall

```bash
cd claude-context-guard
bash uninstall.sh
```

Removes hooks, source files, and skills. Config is preserved at `~/.claude/context-guard/`.

To remove everything:
```bash
rm -rf ~/.claude/context-guard
rm ~/.claude/commands/save-session.md ~/.claude/commands/save-compact.md
```

## License

MIT
