import { existsSync } from "node:fs";

const DEFAULT_CONTEXT_TOKENS = 200_000;

const MODEL_CONTEXT_TOKENS: Record<string, number> = {
  "opus-4": 1_000_000,
  "sonnet-4": 1_000_000,
};

export function getMaxTokensForModel(modelId?: string): number {
  if (!modelId) return DEFAULT_CONTEXT_TOKENS;
  for (const [pattern, tokens] of Object.entries(MODEL_CONTEXT_TOKENS)) {
    if (modelId.includes(pattern)) return tokens;
  }
  return DEFAULT_CONTEXT_TOKENS;
}

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

export async function getContextPercentage(
  transcriptPath: string,
  maxTokens: number = DEFAULT_CONTEXT_TOKENS,
): Promise<number> {
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

    return Math.min(100, Math.round((latestTokens / maxTokens) * 100));
  } catch {
    return 0;
  }
}
