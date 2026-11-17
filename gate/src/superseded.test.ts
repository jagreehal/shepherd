import { describe, expect, test } from "bun:test";
import { foldTargets, priorRounds, supersededBody, type ReviewRecord } from "./github.ts";

describe("superseded reviews", () => {
  const review = (body: string): ReviewRecord => ({ id: 7, user: { login: "github-actions[bot]" }, state: "COMMENTED", body, commit_id: "c".repeat(40) });
  const body = `## ❌ gate: REFUSED <sub>· head \`aaaaaaa\`</sub>\n\nwhy\n<!-- gate-run:2026-10-22T00:00:00Z -->\n<!-- gate-reviewed:head=${"a".repeat(40)};base=${"b".repeat(40)} -->`;

  test("fold under one line naming the verdict and the latest review, keeping every marker", () => {
    const folded = supersededBody(review(body), 99) ?? "";

    // The fold names the round's reason, so the history reads without opening it.
    expect(folded.startsWith('<details><summary>Superseded: shepherd REFUSED on <code>aaaaaaa</code> — why · <a href="#pullrequestreview-99">latest review</a></summary>')).toBe(true);
    expect(folded).toContain(body);
    expect(supersededBody(review(folded), 100)).toBeNull(); // folded once
  });

  test("earlier rounds read one per head, oldest first, each with its verdict and reason, from folded reviews too", () => {
    const approved = body.replace("❌ gate: REFUSED", "✅ gate: APPROVED").replace("\nwhy\n", "\nall good\n").replaceAll("a".repeat(40), "d".repeat(40));
    const error = body.replace("REFUSED", "ERROR");
    const long = body.replace("\nwhy\n", `\n${"word ".repeat(60)}\n`).replaceAll("a".repeat(40), "e".repeat(40));
    const rerun = body.replace("\nwhy\n", "\nwhy again\n");
    const current = body.replaceAll("a".repeat(40), "f".repeat(40));
    const rounds = priorRounds([review(supersededBody(review(body), 9)!), { ...review(error), id: 8 }, { ...review(approved), id: 10 }, review(long), review(rerun), review(current)], "github-actions[bot]", "f".repeat(40));

    // One round per head: the rerun on aaaaaaa replaces its first review and moves to the end; the current head is not history.
    expect(rounds.map((r) => [r.head[0], r.verdict, r.why.slice(0, 9)])).toEqual([["d", "APPROVED", "all good"], ["e", "REFUSED", "word word"], ["a", "REFUSED", "why again"]]);
    expect(rounds[1]!.why.endsWith("word…")).toBe(true); // cut at a word, never mid-word
    expect(rounds[1]!.why.length).toBeLessThanOrEqual(140);
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
