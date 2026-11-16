import { expect, test } from "bun:test";
import type { Thread } from "../gate/src/github.ts";
import { retirable, statusFromGate } from "./ci-status.ts";
import type { PrFacts } from "./status.ts";

const head = "3b240742f60b6fb873bc3e6b5bd4202d9555ec8e";

const facts: PrFacts = { pr: 1, state: "OPEN", head, url: "", gate: { verdict: "APPROVED", head }, changesRequested: [], openThreads: 0, runs: [{ name: "ci", status: "completed", conclusion: "success", url: "" }, { name: "shepherd", status: "in_progress", conclusion: "", url: "" }] };

const status = (f: Partial<PrFacts> = {}) => statusFromGate({ ...facts, ...f }, "shepherd");

test("success needs the gate's approval of this head, every other check green and no open thread", () => {
  expect(status()).toEqual({ state: "success", description: "the gate approved this head; checks green and no open thread" });
  expect(status({ gate: { verdict: "APPROVED", head: "0".repeat(40), kept: true } }).state).toBe("success");
  // Skipped and neutral checks pass; the gate's own red run is its refusal, read from its review instead.
  expect(status({ runs: [{ name: "docs", status: "completed", conclusion: "skipped", url: "" }, { name: "shepherd-gate", status: "completed", conclusion: "failure", url: "" }] }).state).toBe("success");
});

test("the gate's verdict on this head decides; with none yet, or one for an older head, the status waits", () => {
  expect(status({ gate: undefined })).toEqual({ state: "pending", description: "waiting for the gate's review of this head" });
  expect(status({ gate: { verdict: "APPROVED", head: "0".repeat(40) } }).state).toBe("pending");
  expect(status({ gate: { verdict: "REFUSED", head } })).toEqual({ state: "failure", description: "the gate's review of this head is REFUSED: read its review, then push a fix" });
  expect(status({ gate: { verdict: "ESCALATE", head } }).description).toContain("a person decides");

  for (const verdict of ["DISMISSED", "ERROR"]) expect(status({ gate: { verdict, head } }).description).toContain("/gate");
});

test("a red or waiting check, or an open thread, holds an approval back", () => {
  // Green is listed, not red: action_required blocks, and an api-gateway workflow is CI, not the gate.
  expect(status({ runs: [{ name: "deploy-preview", status: "completed", conclusion: "action_required", url: "" }] })).toEqual({ state: "failure", description: "fix deploy-preview" });
  expect(status({ runs: [{ name: "api-gateway", status: "completed", conclusion: "failure", url: "" }] }).state).toBe("failure");
  expect(status({ runs: [{ name: "lint", status: "in_progress", conclusion: "", url: "" }] })).toEqual({ state: "pending", description: "waiting on lint" });
  expect(status({ openThreads: 2 }).state).toBe("failure");
  expect(status({ changesRequested: ["sam"] })).toEqual({ state: "failure", description: "changes requested by sam" });
});

test("threads the approval answered keep it pending, never success, until publish resolves them and counts again", () => {
  expect(status({ openThreads: 2, answeredThreads: 2 })).toEqual({ state: "pending", description: "the gate approved; resolving 2 answered thread(s)" });
  // One of them has a person in it: that one is the author's.
  expect(status({ openThreads: 2, answeredThreads: 1 })).toEqual({ state: "failure", description: "the gate approved; resolve the 1 open review thread(s)" });
});

const comment = (login: string, bot: boolean, body = "> 🤖 Automated comment by **shepherd gate**, not written by a human\n\nclamp ignores min") => ({ author: { login, __typename: bot ? "Bot" : "User" }, body, createdAt: "" });

const thread = (nodes: ReturnType<typeof comment>[], over: Partial<Thread> = {}): Thread => ({ id: "T", isResolved: false, isOutdated: true, path: "src/index.ts", comments: { totalCount: nodes.length, nodes }, ...over });

test("an approval retires the gate's earlier threads and swarm's outdated ones, only when bots alone wrote them", () => {
  expect(retirable(thread([comment("github-actions", true)]), null)).toBe(true);
  expect(retirable(thread([comment("jag", false)]), "jag")).toBe(true); // posted through the operator's own token

  // A person in it, another bot, a pasted header, a thread still on current code, or one read in part: left open.
  expect(retirable(thread([comment("github-actions", true), comment("sam", false, "> 🤖 Automated comment by **x**")]), null)).toBe(false);
  expect(retirable(thread([comment("coderabbitai", true)]), null)).toBe(false);
  expect(retirable(thread([comment("github-actions", true, "looks wrong to me")]), null)).toBe(false);
  expect(retirable(thread([comment("github-actions", true)], { isOutdated: false }), null)).toBe(false);
  // The gate re-raises a finding that still holds, so its own threads from earlier runs are answered even on unchanged lines.
  expect(retirable(thread([comment("github-actions", true, "> 🤖 Automated comment by **shepherd gate**\n\ndivide drops its zero check\n\n<!-- gate-run:2026-11-16T17:32:19.068Z -->")], { isOutdated: false }), null)).toBe(true);
  expect(retirable(thread([comment("github-actions", true)], { comments: { totalCount: 51, nodes: [comment("github-actions", true)] } }), null)).toBe(false);
  expect(retirable(thread([comment("github-actions", true)], { isResolved: true }), null)).toBe(false);
});
