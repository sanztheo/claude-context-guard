import type { HookInput, HookOutput } from "./types.ts";
import { getContextPercentage } from "./context.ts";
import { getUsageData } from "./usage.ts";
import { loadConfig } from "./config.ts";

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
  return hours > 0
    ? `${hours}h${String(minutes).padStart(2, "0")}m`
    : `${minutes}m`;
}

function inject(hookEvent: string, msg: string): void {
  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: hookEvent,
      additionalContext: msg,
    },
  };
  console.log(JSON.stringify(output));
}

async function main(): Promise<void> {
  const input: HookInput = JSON.parse(await Bun.stdin.text());

  const config = await loadConfig();
  if (!config.enabled) return;

  const sessionId = input.session_id;
  const hookEvent = input.hook_event_name ?? "PostToolUse";
  const isSessionStart = hookEvent === "SessionStart";
  const warnState = await getWarnState(sessionId);

  // 1. Context %
  const contextPct = await getContextPercentage(input.transcript_path);

  // 2. Usage % (cached)
  let usagePct = 0;
  let usage7dPct = 0;
  let usageResetTime = "";
  if (config.check_usage_api) {
    const usage = await getUsageData(config.cache_ttl_seconds);
    if (usage) {
      usagePct = Math.round(
        usage.five_hour.utilization <= 1
          ? usage.five_hour.utilization * 100
          : usage.five_hour.utilization,
      );
      usage7dPct = Math.round(
        usage.seven_day.utilization <= 1
          ? usage.seven_day.utilization * 100
          : usage.seven_day.utilization,
      );
      usageResetTime = formatTimeUntil(usage.five_hour.resets_at);
    }
  }

  // 3. SessionStart: compact briefing via additionalContext
  if (isSessionStart) {
    const parts = [`ctx:${contextPct}%`];
    if (config.check_usage_api) {
      parts.push(
        `5h:${usagePct}%${usageResetTime ? `(${usageResetTime})` : ""}`,
      );
      parts.push(`7d:${usage7dPct}%`);
    }
    inject(hookEvent, `[CG] ${parts.join(" · ")}`);
    // Don't return — still check thresholds below
  }

  // 4. Threshold warnings
  const warnings: string[] = [];
  let needsDump = false;

  if (
    contextPct >= config.context_critical_pct &&
    !warnState.context_critical
  ) {
    warnings.push(`[CG] CRITICAL ctx:${contextPct}% — compact NOW`);
    warnState.context_critical = true;
    warnState.context_warned = true;
    needsDump = true;
  } else if (
    contextPct >= config.context_warning_pct &&
    !warnState.context_warned
  ) {
    warnings.push(`[CG] WARNING ctx:${contextPct}% — wrap up soon`);
    warnState.context_warned = true;
  }

  if (usagePct >= config.usage_critical_pct && !warnState.usage_critical) {
    warnings.push(`[CG] CRITICAL usage:${usagePct}% resets ${usageResetTime}`);
    warnState.usage_critical = true;
    warnState.usage_warned = true;
    needsDump = true;
  } else if (usagePct >= config.usage_warning_pct && !warnState.usage_warned) {
    warnings.push(`[CG] WARNING usage:${usagePct}% resets ${usageResetTime}`);
    warnState.usage_warned = true;
  }

  // 5. Critical: instruct Claude to save state
  if (needsDump) {
    const projectDir = input.workspace?.project_dir ?? input.cwd ?? ".";
    const stateFile = `${projectDir}/.context-guard/state.md`;
    warnings.push(
      `ACTION REQUIRED: Write a detailed state file to ${stateFile} with:\n` +
        `- Session ID: ${sessionId} (resume: claude -r ${sessionId})\n` +
        `- Summary of everything done this session\n` +
        `- Current status and any blockers\n` +
        `- Exact next steps to continue\n` +
        `- Key files modified\n` +
        `Then run /compact or suggest starting a new session.`,
    );
  }

  // 6. Output warnings
  if (warnings.length > 0) {
    inject(hookEvent, warnings.join("\n"));
  }

  // 7. Save state
  await saveWarnState(warnState);
}

main().catch(() => process.exit(0));
