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
