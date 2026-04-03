import type { UsageData, UsageCache } from "./types.ts";

const CACHE_PATH = "/tmp/claude-context-guard-cache.json";
const KEYCHAIN_SERVICE = "Claude Code-credentials";

async function getOAuthToken(): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { stdout: "pipe", stderr: "pipe" },
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

export async function getUsageData(
  cacheTtlSeconds: number,
): Promise<UsageData | null> {
  const cached = await readCache(cacheTtlSeconds);
  if (cached) return cached;

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
