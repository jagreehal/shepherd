import { describe, expect, test } from "bun:test";
import { latestVerdict, reviewedMarker, runMarker } from "../gate/src/github.ts";
import { type PrFacts, prStatus } from "./status.ts";

const base: PrFacts = { pr: 7, state: "OPEN", head: "abcdef1234", url: "https://github.com/o/r/pull/7", changesRequested: [], openThreads: 0, runs: [] };

const approved = { verdict: "APPROVED", head: "abcdef1" };

const ciFailed = { name: "ci", status: "completed", conclusion: "failure", url: "" };

describe("shepherd status", () => {
  test("folds the gate, shepherd and CI into one stage and one next step", () => {
    expect(prStatus(base)).toMatchObject({ stage: "reviewing", next: expect.stringContaining("/shepherd") });
    expect(prStatus({ ...base, runs: [{ name: "ci", status: "in_progress", conclusion: "", url: "" }] }).stage).toBe("waiting for CI");
    expect(prStatus({ ...base, shepherd: { state: "pending", description: "running" } }).stage).toBe("fixing");
    expect(prStatus({ ...base, shepherd: { state: "failure", description: "stopped after 5 commits" } })).toMatchObject({ stage: "needs you", next: expect.stringContaining("stopped after 5 commits") });
    expect(prStatus({ ...base, gate: approved, shepherd: { state: "success", description: "ready" } }).stage).toBe("ready");
    expect(prStatus({ ...base, gate: { verdict: "ESCALATE", head: "abcdef1" } }).stage).toBe("needs you");
    expect(prStatus({ ...base, state: "MERGED", shepherd: { state: "pending", description: "" } }).stage).toBe("merged");
  });

  test("a current blocker wins over an earlier success: failed CI, a refusal on this head, a person's requested changes", () => {
    const success = { state: "success", description: "ready to merge" };

    expect(prStatus({ ...base, gate: approved, shepherd: success, runs: [ciFailed] }).stage).toBe("needs you");
    expect(prStatus({ ...base, gate: { verdict: "REFUSED", head: "abcdef1" }, shepherd: success }).stage).toBe("needs you");
    expect(prStatus({ ...base, gate: approved, shepherd: success, changesRequested: ["sam"] })).toMatchObject({ stage: "needs you", next: expect.stringContaining("sam") });
    expect(prStatus({ ...base, gate: { verdict: "REFUSED", head: "abcdef1" }, runs: [{ name: "shepherd-gate", status: "completed", conclusion: "failure", url: "" }] }).next).toContain("the gate's review");
    expect(prStatus({ ...base, gate: { verdict: "DISMISSED", head: "abcdef1" } }).stage).toBe("needs you");
    expect(prStatus({ ...base, gate: approved, shepherd: success, openThreads: 2 })).toMatchObject({ stage: "needs you", next: expect.stringContaining("2 open review threads") });
    expect(prStatus({ ...base, gate: approved, shepherd: success, runs: [{ name: "ci/circleci", status: "completed", conclusion: "failure", url: "" }] }).stage).toBe("needs you");
  });

  test("a running gate or CI job is named over shepherd's pending status, and an older head's approval is not ready", () => {
    const pending = { state: "pending", description: "waiting for the gate" };

    expect(prStatus({ ...base, shepherd: pending, runs: [{ name: "shepherd-gate", status: "in_progress", conclusion: "", url: "" }] }).stage).toBe("reviewing");
    expect(prStatus({ ...base, shepherd: pending, runs: [{ name: "ci", status: "queued", conclusion: "", url: "" }] }).stage).toBe("waiting for CI");

    const stale = prStatus({ ...base, gate: { verdict: "APPROVED", head: "0000000" } });

    expect(stale.stage).toBe("reviewing");
    expect(stale.lines[1]).toContain("an older head");

    const kept = prStatus({ ...base, gate: { verdict: "APPROVED", head: "0000000", kept: true }, shepherd: { state: "success", description: "ready" } });

    expect(kept.stage).toBe("ready");
    expect(kept.lines[1]).toContain("kept from 0000000");
  });
});

describe("the gate's verdict as status reads it", () => {
  const head = "a".repeat(40);
  const body = (verdict: string) => `## ✅ shepherd gate: ${verdict}\n\nlooks fine\n\n${runMarker("2026-11-14T00:00:00Z")}${reviewedMarker(head, "b".repeat(40))}`;
  const review = (login: string, text: string, state = "COMMENTED") => ({ id: 1, user: { login }, state, body: text, commit_id: "c".repeat(40) });

  test("only a bot's review with the gate's markers counts, and a dismissed approval is not an approval", () => {
    expect(latestVerdict([review("github-actions[bot]", body("APPROVED"), "APPROVED")])).toEqual({ verdict: "APPROVED", head, base: "b".repeat(40), evidenceUnseen: false });
    expect(latestVerdict([review("sam", body("APPROVED"))])).toBeUndefined(); // a person pasting the heading and markers
    expect(latestVerdict([review("github-actions[bot]", "## ✅ shepherd gate: APPROVED")])).toBeUndefined(); // no markers
    expect(latestVerdict([review("github-actions[bot]", body("APPROVED"), "DISMISSED")])?.verdict).toBe("DISMISSED");
    expect(latestVerdict([review("github-actions[bot]", body("APPROVED"), "APPROVED"), review("github-actions[bot]", body("REFUSED"))])?.verdict).toBe("REFUSED");
  });
});
