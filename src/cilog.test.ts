import { expect, test } from "bun:test";
import { analyzeLog } from "./cilog.ts";

test("indexes failures on the file's own line numbers", () => {
  const log = ["setup ok", "Error: boom", "    at f (a.ts:1:1)", "    at g (a.ts:2:1)", "1 failed", "##[error]Process completed with exit code 1."].join("\n");
  const a = analyzeLog(log);

  expect(a.index.map((l) => [l.line, l.type])).toEqual([[2, "error"], [3, "trace"], [5, "failure"], [6, "error"]]);
  expect(a.excerpt.content).toContain("Error: boom");
  expect(a.excerpt.end_line).toBe(6);
});

test("reads through gh's job, step and timestamp columns and ANSI colours", () => {
  const a = analyzeLog("build\tRun tests\t2026-01-02T03:04:05.1234567Z \x1b[31m    at f (a.ts:1:1)\x1b[0m");

  expect(a.index[0]).toEqual({ line: 1, type: "trace", content: "at f (a.ts:1:1)" });
});

test("centres the excerpt on the last error, with the tail as the fallback", () => {
  const filler = Array.from({ length: 200 }, (_, i) => `line ${i}`);

  expect(analyzeLog([...filler, "##[error]bad", ...filler].join("\n")).excerpt).toMatchObject({ start_line: 126, end_line: 205 });
  expect(analyzeLog(filler.join("\n")).excerpt.start_line).toBe(121);
});

test("a package manager's WARN is noise, and a long line is cut", () => {
  const a = analyzeLog(`WARN apt cache stale\nWARN real one\nError: ${"x".repeat(300)}`);

  expect(a.index.map((l) => l.line)).toEqual([2, 3]);
  expect(a.index[1]!.content.length).toBe(120);
});

test("the index stops growing on a log that is all failures", () => {
  expect(analyzeLog(Array.from({ length: 500 }, () => "Error: x").join("\n")).index.length).toBe(200);
});
