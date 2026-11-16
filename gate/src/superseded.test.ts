import { describe, expect, test } from "bun:test";
import { foldTargets, supersededBody, type ReviewRecord } from "./github.ts";

describe("superseded reviews", () => {
  const review = (body: string): ReviewRecord => ({ id: 7, user: { login: "github-actions[bot]" }, state: "COMMENTED", body, commit_id: "c".repeat(40) });
  const body = `## ❌ gate: REFUSED <sub>· head \`aaaaaaa\`</sub>\n\nwhy\n<!-- gate-run:2026-10-22T00:00:00Z -->\n<!-- gate-reviewed:head=${"a".repeat(40)};base=${"b".repeat(40)} -->`;

  test("fold under one line naming the verdict and the latest review, keeping every marker", () => {
    const folded = supersededBody(review(body), 99) ?? "";

    expect(folded.startsWith('<details><summary>Superseded: gate REFUSED on <code>aaaaaaa</code> · <a href="#pullrequestreview-99">latest review</a></summary>')).toBe(true);
    expect(folded).toContain(body);
    expect(supersededBody(review(folded), 100)).toBeNull(); // folded once
  });

  test("a run folds only runs older than itself, and folds nothing once a newer run has posted", () => {
    const run = (id: number, started: string): ReviewRecord => ({ ...review(body.replace("2026-10-22T00:00:00Z", started)), id });
    const older = run(1, "2026-10-22T09:00:00Z");
    const mine = run(2, "2026-10-22T10:00:00Z");
    const newer = run(3, "2026-10-22T11:00:00Z");

    expect(foldTargets([older, mine], 2, "github-actions[bot]", "2026-10-22T10:00:00Z")).toEqual([1]);
    expect(foldTargets([older, mine, newer], 2, "github-actions[bot]", "2026-10-22T10:00:00Z")).toBeNull();
  });
});
