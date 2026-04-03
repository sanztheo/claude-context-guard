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

export async function getContextPercentage(
  transcriptPath: string,
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

    return Math.min(100, Math.round((latestTokens / MAX_CONTEXT_TOKENS) * 100));
  } catch {
    return 0;
  }
}
