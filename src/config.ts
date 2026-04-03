import type { GuardConfig } from "./types.ts";
import { existsSync } from "node:fs";

function expandPath(p: string): string {
  return p.replace(/^~/, process.env.HOME ?? "~");
}

const CONFIG_PATH = expandPath("~/.claude/context-guard/config.json");

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
