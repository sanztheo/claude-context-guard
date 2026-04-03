import type { HookInput, HookOutput } from "./types.ts";
import { getContextPercentage } from "./context.ts";
import { getUsageData } from "./usage.ts";
import { createStateDump } from "./dump.ts";
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
  if (
    contextPct >= config.context_critical_pct &&
    !warnState.context_critical
  ) {
    warnings.push(
      `[CONTEXT GUARD - CRITICAL] Context window at ${contextPct}%. ` +
        `Compaction is imminent. Save your current state NOW, then use /compact.`,
    );
    warnState.context_critical = true;
    warnState.context_warned = true;
    needsDump = true;
  } else if (
    contextPct >= config.context_warning_pct &&
    !warnState.context_warned
  ) {
    warnings.push(
      `[CONTEXT GUARD - WARNING] Context window at ${contextPct}%. ` +
        `Consider wrapping up the current task. A state dump will be saved at ${config.context_critical_pct}%.`,
    );
    warnState.context_warned = true;
  }

  // Usage warnings
  if (usagePct >= config.usage_critical_pct && !warnState.usage_critical) {
    warnings.push(
      `[CONTEXT GUARD - USAGE CRITICAL] API usage at ${usagePct}% (resets in ${usageResetTime}). ` +
        `You may hit rate limits soon. Consider pausing or switching to a lighter model.`,
    );
    warnState.usage_critical = true;
    warnState.usage_warned = true;
    needsDump = true;
  } else if (usagePct >= config.usage_warning_pct && !warnState.usage_warned) {
    warnings.push(
      `[CONTEXT GUARD - USAGE WARNING] API usage at ${usagePct}% (resets in ${usageResetTime}). ` +
        `Monitor your usage — limit approaching.`,
    );
    warnState.usage_warned = true;
  }

  // 4. Auto-dump on critical
  if (needsDump) {
    const trigger =
      contextPct >= config.context_critical_pct
        ? `context at ${contextPct}%`
        : `usage at ${usagePct}%`;
    const dumpPath = await createStateDump(
      input,
      config,
      contextPct,
      usagePct,
      trigger,
    );
    warnings.push(
      `State dump saved to: ${dumpPath}\n` +
        `Session ID: ${sessionId}\n` +
        `Resume: claude -r ${sessionId}`,
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
