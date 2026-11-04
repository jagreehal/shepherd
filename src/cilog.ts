// A failed job's log, indexed.

export type LogLine = { line: number; type: "error" | "warning" | "failure" | "trace"; content: string };

export type LogAnalysis = { total_lines: number; index: LogLine[]; excerpt: { start_line: number; end_line: number; content: string } };

const PATTERNS: { type: LogLine["type"]; pattern: RegExp; skip?: RegExp }[] = [
  { type: "error", pattern: /##\[error\]/i },
  { type: "error", pattern: /\bError:/i },
  { type: "error", pattern: /\bERR_/i },
  { type: "error", pattern: /exit code [1-9]/i },
  { type: "warning", pattern: /##\[warning\]/i },
  { type: "warning", pattern: /\bWARN\b/i, skip: /apt|dpkg|Reading package/i },
  { type: "failure", pattern: /\d+ failed/i },
  { type: "failure", pattern: /FAIL\b/i },
  { type: "failure", pattern: /✕|✗|×/ },
  { type: "trace", pattern: /^\s+at\s+/i },
];

const MAX_INDEX = 200;

const MAX_LINE = 120;

const EXCERPT = 80;

const AFTER = 5;

// `gh run view --log-failed` opens each line with the job, the step and a timestamp; a raw job log with the timestamp.
const PREFIX = /^(?:[^\t]*\t[^\t]*\t)?\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/;

/**
 * A map of a failed job's log: an index of its error, warning, failure and first stack-trace lines,
 * and a window around the last `##[error]` (the tail when there is none). `line` numbers the file given, so a reader
 * goes straight there instead of loading the log.
 */
export function analyzeLog(log: string): LogAnalysis {
  // eslint-disable-next-line no-control-regex -- ANSI escapes are control characters
  const lines = log.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((l) => l.replace(PREFIX, ""));
  const index: LogLine[] = [];

  for (const [i, l] of lines.entries()) {
    const hit = PATTERNS.find((p) => p.pattern.test(l) && !p.skip?.test(l));

    if (!hit || index.length >= MAX_INDEX || (hit.type === "trace" && index.at(-1)?.type === "trace")) continue;
    const text = l.trim();

    index.push({ line: i + 1, type: hit.type, content: text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 3)}...` : text });
  }

  const last = lines.map((l) => /##\[error\]/i.test(l)).lastIndexOf(true);
  const start = Math.max(0, last === -1 ? lines.length - EXCERPT : last - (EXCERPT - AFTER));
  const end = last === -1 ? lines.length : Math.min(lines.length, last + AFTER);

  return { total_lines: lines.length, index, excerpt: { start_line: start + 1, end_line: end, content: lines.slice(start, end).join("\n") } };
}
