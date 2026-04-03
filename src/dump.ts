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

async function extractTranscriptSummary(
  transcriptPath: string,
): Promise<TranscriptSummary> {
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

        if (entry.type === "human") {
          const msgContent = entry.message?.content;
          if (typeof msgContent === "string" && msgContent.trim()) {
            summary.recent_messages.push(msgContent.trim().slice(0, 200));
          } else if (Array.isArray(msgContent)) {
            for (const part of msgContent) {
              if (part?.type === "text" && part.text?.trim()) {
                summary.recent_messages.push(part.text.trim().slice(0, 200));
              }
            }
          }
        }

        if (
          entry.type === "assistant" &&
          Array.isArray(entry.message?.content)
        ) {
          for (const part of entry.message.content) {
            if (part?.type !== "tool_use") continue;
            const input = part.input ?? {};
            if (input.file_path) filesSet.add(input.file_path);
            const name = part.name ?? "";
            if (["Edit", "Write", "Bash"].includes(name)) {
              const desc = input.description ?? input.command ?? name;
              summary.recent_actions.push(
                `${name}: ${String(desc).slice(0, 100)}`,
              );
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

function resolveProjectDumpDir(hookInput: HookInput): string {
  const projectDir = hookInput.workspace?.project_dir ?? hookInput.cwd;
  if (projectDir) return `${projectDir}/.context-guard`;
  return expandPath("~/.claude/context-guard/dumps");
}

export async function createStateDump(
  hookInput: HookInput,
  config: GuardConfig,
  contextPct: number,
  usagePct: number,
  trigger: string,
): Promise<string> {
  const dumpDir = resolveProjectDumpDir(hookInput);
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
