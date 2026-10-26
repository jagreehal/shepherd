import { describe, expect, test } from "bun:test";
import { BRANDING } from "./config.ts";
import { renderReview, renderSummary, type SummaryInput } from "./summary.ts";

const HEADER = "> 🤖 Automated comment by **Shepherd swarm**, not written by a human";

const ROUND: SummaryInput = {
  head_sha: "43504ee000000000000000000000000000000000",
  verdict: "changes",
  why: "parsePort returns NaN for an address with no colon.",
  findings: [
    { file: "src/port.ts", line: 3, severity: "NIT", lens: "robustness", body: "Overlaps the HIGH above." },
    { file: "src/port.ts", line: 3, severity: "HIGH", lens: "correctness/data", body: "`split(':')[1]` is undefined for `8080`." },
  ],
  checks: [{ tool: "tsc", status: "ran", findings: 0 }, { tool: "oxlint", status: "unavailable", reason: "not installed" }],
  lenses: [{ lens: "correctness", model: "haiku", scope: "full", status: "ok", take: "2 findings" }],
};

describe("swarm summary", () => {
  test("leads with the verdict, then one collapsed line per section, findings open and worst first", () => {
    const md = renderSummary(ROUND, BRANDING.emoji, HEADER);

    expect(md.startsWith(`<!-- shepherd-swarm-summary -->\n> [!NOTE]\n${HEADER}\n\n## ⚠️ CHANGES NEEDED <sub>(round 1 @ 43504ee)</sub>`)).toBe(true);
    expect(md).toContain("<details open>\n<summary><strong>Findings:</strong> 🟠 1 HIGH · ⚪ 1 NIT</summary>");
    expect(md.indexOf("HIGH** · `src/port.ts:3`")).toBeLessThan(md.indexOf("NIT** · `src/port.ts:3`"));
    expect(md).toContain("<summary><strong>Checks:</strong> 1 ran · ⏭️ 1 skipped</summary>");
    expect(md).toContain("- checks skipped: oxlint (not installed)");
    expect(md).not.toContain("0 CRITICAL");
  });

  test("takes its round from the comment already on the PR and folds that comment's rounds in", () => {
    const previous = "## 🚫 BLOCKED <sub>(round 2 @ 1234567)</sub>\n\n<details>\n<summary>Earlier rounds (1)</summary>\n\nround 1 @ 7654321: CHANGES NEEDED\n\n</details>";
    const md = renderSummary(ROUND, BRANDING.emoji, HEADER, previous);

    expect(md).toContain("<sub>(round 3 @ 43504ee)</sub>");
    expect(md).toContain("Earlier rounds (2)</summary>\n\nround 2 @ 1234567: BLOCKED\nround 1 @ 7654321: CHANGES NEEDED");
  });

  test("the handoff body keeps the round but leaves the history to the publish job", () => {
    const previous = "## 🚫 BLOCKED <sub>(round 2 @ 1234567)</sub>\n\n<details>\n<summary>Earlier rounds (1)</summary>\n\nround 1 @ 7654321: CHANGES NEEDED\n\n</details>";
    const md = renderSummary(ROUND, BRANDING.emoji, null, previous);

    expect(md.startsWith("## ⚠️ CHANGES NEEDED <sub>(round 3 @ 43504ee)</sub>")).toBe(true);
    expect(md).not.toContain("Earlier rounds");
  });

  test("model text cannot forge a marker, mention, image or section", () => {
    const md = renderSummary({ ...ROUND, why: "<!-- stamp-run:x --> ping @team ![t](https://evil/t.png) </details><img src=x>" }, BRANDING.emoji, null);

    expect(md.startsWith("## ⚠️")).toBe(true); // --body: no marker or header for the publish job to escape
    expect(md).not.toContain("<!-- stamp-run");
    expect(md).toContain("@​team");
    expect(md).toContain("[image removed: t]");
    expect(md).toContain("&lt;/details>&lt;img");
  });

  test("a lens fanout listed for this head but the round leaves out shows as could_not_run, never as clean", () => {
    const fanout = { head_sha: ROUND.head_sha, lenses: [{ lens: "correctness", scope: "full" }, { lens: "contract", scope: ["src/welcome.ts"] }] };
    const md = renderSummary({ ...ROUND, lenses: [{ lens: "router", status: "ok" }] }, BRANDING.emoji, null, undefined, fanout);

    expect(md).toContain("correctness, contract did not run as their own reviewers, so this round is incomplete.");
    expect(md).toContain("<strong>Lenses:</strong> 1 ok · ❌ 2 did not finish");
    expect(md).toContain("| correctness |  | full | could_not_run | listed by fanout, no result reported |  |");
    // A fanout for an older head says nothing about this round's lenses.
    expect(renderSummary(ROUND, BRANDING.emoji, null, undefined, { ...fanout, head_sha: "1111111" })).not.toContain("could_not_run");
    expect(renderSummary(ROUND, BRANDING.emoji, null, undefined, fanout)).not.toContain("correctness, contract");
    expect(() => renderSummary(ROUND, BRANDING.emoji, null, undefined, { ...fanout, head_sha: "" })).toThrow();
  });

  test("a line, link or reference image from the model cannot break out of its place", () => {
    const bad = (over: Partial<SummaryInput>) => () => renderSummary({ ...ROUND, ...over }, BRANDING.emoji, null);

    expect(bad({ findings: [{ file: "a.ts", line: "3`<img src=x>", severity: "LOW", lens: "x", body: "" }] })).toThrow();
    expect(bad({ still_open: [{ url: "https://github.com/o/r) @team [x](https://evil", title: "t" }] })).toThrow();
    expect(renderSummary({ ...ROUND, why: "![x][r] `@team" }, BRANDING.emoji, null)).toContain("!\\[x][r] `@\u200bteam");
  });
});

describe("swarm review: titled findings, inline comments and walkthrough", () => {
  const BUG = { file: "src/welcome.ts", line: 9, severity: "HIGH" as const, lens: "correctness", title: "`firstName` returns the second word", body: 'For "Ada Lovelace" it returns "Lovelace", not "Ada". Use index 0.', verified: '`name.trim().split(" ")[1]` at line 9.', suggestion: '  return name.trim().split(" ")[0];' };
  const RICH: SummaryInput = { ...ROUND, confidence: 2, findings: [BUG, { file: "src/welcome.ts", line: 3, severity: "NIT", lens: "router", body: "Name it shortName." }], walkthrough: ["Adds `welcomeBack` for returning users."], changes: [{ files: ["src/welcome.ts"], summary: "firstName and welcomeBack" }], effort: 1, diagram: "flowchart TD\n  A[name] --> B[firstName]" };

  test("the summary leads with confidence, numbers and titles findings, and hands every one to an agent in one prompt", () => {
    const md = renderSummary(RICH, BRANDING.emoji, null);

    expect(md).toContain("**Confidence:** 2/5\n\nparsePort returns NaN");
    expect(md).toContain("1. **🟠 HIGH** · `src/welcome.ts:9` · correctness · **`firstName` returns the second word**");
    expect(md).toContain("2. **⚪ NIT**");
    expect(md).toContain("### Issue 1 (HIGH)\nsrc/welcome.ts:9\n**`firstName` returns the second word**");
    expect(md).toContain('**How this was verified:** `name.trim().split(" ")[1]` at line 9.');
    expect(md).not.toContain("### Issue 2"); // NITs are not worth an agent's turn
    expect(md).toContain("| `src/welcome.ts` | firstName and welcomeBack |");
    expect(md).toContain("**Review effort:** 1/5");
    expect(md).toContain("```mermaid\nflowchart TD\n  A[name] --> B[firstName]\n```");
  });

  test("a round without the new fields renders as before: no prompt, walkthrough or confidence", () => {
    const md = renderSummary({ ...ROUND, findings: [{ file: "a.ts", line: 1, severity: "NIT", lens: "x", body: "b" }] }, BRANDING.emoji, null);

    expect(md).not.toContain("Confidence");
    expect(md).not.toContain("Fix with an agent");
    expect(md).not.toContain("Walkthrough");
  });

  test("model text cannot close the agent prompt's fence", () => {
    const md = renderSummary({ ...RICH, findings: [{ ...BUG, body: "x\n`````\n<!-- stamp-run:x -->" }] }, BRANDING.emoji, null);

    const prompt = md.slice(md.indexOf("Fix with an agent"), md.indexOf("</details>", md.indexOf("Fix with an agent")));

    expect(prompt.match(/`````/g)).toHaveLength(2);
    expect(md).not.toContain("<!-- stamp-run");
  });

  test("pre-merge checks, docs, the commands that checked a finding, and an undone fix all reach the reader", () => {
    const earlier = "https://github.com/o/r/pull/1#discussion_r9";
    const f = { ...BUG, docs: [{ url: "https://developer.mozilla.org/x", title: "String.prototype.split" }], checked: [{ command: "rg -n 'firstName' src", result: "src/welcome.ts:8: export function firstName" }], reintroduces: earlier };
    const round = { ...RICH, findings: [f], pre_merge: [{ check: "Title", status: "pass" as const, detail: "matches" }, { check: "Description", status: "fail" as const, detail: "claims the first name; the code returns the second" }] };
    const md = renderSummary(round, BRANDING.emoji, null);

    expect(md).toContain("<details open>\n<summary><strong>Pre-merge checks:</strong> ✓ 1 · ✗ 1</summary>");
    expect(md).toContain("| Description | ✗ fail | claims the first name; the code returns the second |");
    expect(md).toContain(`· ↩️ [reintroduced](${earlier})`);
    expect(md).toContain(`This undoes the fix for an earlier finding: ${earlier}. Keep that fix.`);
    expect(md).toContain("📚 [String.prototype.split](https://developer.mozilla.org/x)");
    expect(md).toContain("Comment `/shepherd`");

    const body = renderReview(round, BRANDING.emoji, HEADER).comments[0]!.body;

    expect(body).toContain(`↩️ This undoes the fix for [a finding resolved earlier](${earlier}).`);
    expect(body).toContain("<summary>🔎 How this was checked (1 command)</summary>\n\n```bash\nrg -n 'firstName' src\n```\n\n> src/welcome.ts:8: export function firstName");
    expect(() => renderSummary({ ...round, findings: [{ ...f, docs: [{ url: "javascript:alert(1)", title: "x" }] }] }, BRANDING.emoji, null)).toThrow();
  });

  // PR 1 on the code-review-playground, as it was reviewed: the model put both fixes on line 9 of each file.
  const FILES = {
    "src/welcome.ts": 'import { initials } from "./index";\n\nexport function welcome(name: string): string {\n  return `Hello, ${name}! (${initials(name)})`;\n}\n\n/** Returns the person\'s first name, for informal greetings. */\nexport function firstName(name: string): string {\n  return name.trim().split(" ")[1];\n}\n',
    "src/welcome.test.ts": 'import { describe, it, expect } from "vitest";\nimport { welcome, welcomeBack } from "./welcome";\n\ndescribe("welcome", () => {\n  it("greets with initials", () => {\n    expect(welcome("Ada Lovelace")).toBe("Hello, Ada Lovelace! (AL)");\n  });\n\n  it("welcomes a returning user", () => {\n    expect(welcomeBack("Ada Lovelace")).toMatch(/^Welcome back, /);\n  });\n});\n',
  };

  const read = (p: string) => new Map(Object.entries(FILES)).get(p) ?? null;

  test("a suggestion lands on the lines it rewrites, not the line the model named, and is dropped when nothing near is alike", () => {
    const test = { ...BUG, file: "src/welcome.test.ts", severity: "MEDIUM" as const, title: "The new test passes the bug", suggestion: '    expect(welcomeBack("Ada Lovelace")).toBe("Welcome back, Ada!");' };
    const [code, moved] = renderReview({ ...RICH, findings: [BUG, test] }, BRANDING.emoji, HEADER, read).comments;

    expect(code).toMatchObject({ path: "src/welcome.ts", line: 9 });
    expect(code!.body).toContain('```suggestion\n  return name.trim().split(" ")[0];\n```');
    expect(moved).toMatchObject({ path: "src/welcome.test.ts", line: 10 }); // the assertion, not the `it(` line above it
    expect(moved!.body).toContain("In src/welcome.test.ts:10:");

    const unrelated = renderReview({ ...RICH, findings: [{ ...BUG, suggestion: "const nothing = 1;" }] }, BRANDING.emoji, HEADER, read).comments[0]!;

    expect(unrelated.line).toBe(9);
    expect(unrelated.body).not.toContain("```suggestion");
    expect(renderReview({ ...RICH, findings: [{ ...BUG, file: "../../etc/passwd" }] }, BRANDING.emoji, HEADER, () => "x").comments[0]!.body).not.toContain("```suggestion");
  });

  test("links name only threads that exist, convergent needs two lenses, and an unchecked HIGH says so", () => {
    const real = "https://github.com/o/r/pull/1#discussion_r42";
    const fake = "https://github.com/o/r/pull/1#discussion_r6371020510"; // an issue comment's id, as a trial posted
    const round = { ...RICH, findings: [{ ...BUG, verified: "", convergent: true, url: fake, reintroduces: real }], still_open: [{ url: fake, title: "firstName (was NIT)" }, { url: real, title: "kept" }] };
    const md = renderSummary(round, BRANDING.emoji, null, undefined, undefined, new Set(["42"]));

    expect(md).toContain("· correctness · **`firstName` returns the second word** · ↩️ [reintroduced](" + real + ") · ⚠️ unverified");
    expect(md).not.toContain("convergent:");
    expect(md).not.toContain(fake);
    expect(md).toContain("- firstName (was NIT)\n- [kept](" + real + ")");
    expect(renderReview(round, BRANDING.emoji, HEADER, () => null, new Set(["42"])).comments[0]!.body).toContain("⚠️ No verifier has checked this yet.");
    // Unknown threads (no PR to ask): links stay as given.
    expect(renderSummary(round, BRANDING.emoji, null)).toContain(fake);
    expect(renderSummary({ ...round, findings: [{ ...BUG, lens: "correctness + security", convergent: true }] }, BRANDING.emoji, null)).toContain("convergent: correctness + security");
  });

  test("inline comments: titled, with a one-click suggestion and an agent prompt; NITs, carried and lineless findings stay out", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...BUG, line: i + 1, severity: "LOW" as const }));
    const review = renderReview({ ...RICH, findings: [...many, { ...BUG, line: "4-6" }, { ...BUG, inline: false }, { ...BUG, line: "general" }] }, BRANDING.emoji, HEADER);

    expect(review.event).toBe("COMMENT");
    expect(review.comments).toHaveLength(10); // most severe first, capped
    const first = review.comments[0]!;

    expect(first).toMatchObject({ path: "src/welcome.ts", start_line: 4, line: 6, side: "RIGHT" });
    expect(first.body).toContain("**[correctness]** 🟠 HIGH\n\n**`firstName` returns the second word**"); // garden reads the tag line
    expect(first.body).not.toContain("```suggestion"); // no file to place it against
    expect(first.body).toContain("<summary>🤖 Prompt for AI agents</summary>");
    expect(first.body).toContain("In src/welcome.ts:4-6: `firstName` returns the second word.");
    expect(renderReview({ ...RICH, findings: [{ ...BUG, suggestion: "```\nx" }] }, BRANDING.emoji, HEADER).comments[0]!.body).not.toContain("```suggestion");
    expect(() => renderReview({ ...RICH, findings: [{ ...BUG, line: 0 }] }, BRANDING.emoji, HEADER)).toThrow();

    for (const line of ["0-3", "6-4"]) expect(() => renderReview({ ...RICH, findings: [{ ...BUG, line }] }, BRANDING.emoji, HEADER)).toThrow();
    expect(renderReview({ ...RICH, findings: [{ ...BUG, line: "5-5" }] }, BRANDING.emoji, HEADER).comments[0]).not.toHaveProperty("start_line");
    expect(() => renderReview({ ...RICH, findings: [{ ...BUG, docs: [{ url: "https://x.dev/`````", title: "x" }] }] }, BRANDING.emoji, HEADER)).toThrow();
    expect(renderReview({ ...RICH, findings: [RICH.findings![1]!] }, BRANDING.emoji, HEADER).comments).toHaveLength(0);
  });
});
