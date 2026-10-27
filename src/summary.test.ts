import { describe, expect, test } from "bun:test";
import { BRANDING } from "./config.ts";
import { adviceOverCode, anchorSuggestion, reindent, renderReview, renderSummary, type SummaryInput } from "./summary.ts";

const HEADER = "> 🤖 Automated comment by **Shepherd swarm**, not written by a human";

const ROUND: SummaryInput = {
  head_sha: "43504ee000000000000000000000000000000000",
  verdict: "changes",
  why: "parsePort returns NaN for an address with no colon.",
  findings: [
    { file: "src/port.ts", line: 3, severity: "NIT", lens: "robustness", body: "Overlaps the HIGH above." },
    { file: "src/port.ts", line: 3, severity: "HIGH", lens: "correctness/data", body: "`split(':')[1]` is undefined for `8080`.", evidence: { input: "`8080`", expected: "port 8080", actual: "NaN" } },
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
    // A link that is not a GitHub thread URL is dropped and its title kept.
    const md = renderSummary({ ...ROUND, still_open: [{ url: "https://github.com/o/r) @team [x](https://evil", title: "t" }], findings: [{ ...ROUND.findings![1]!, url: "not a url", reintroduces: "javascript:x" }] }, BRANDING.emoji, null);
    expect(md).toContain("- t\n");
    expect(md).not.toContain("evil");
    expect(md).not.toContain("javascript:");
    expect(md).not.toContain("not a url");
    expect(renderSummary({ ...ROUND, why: "![x][r] `@team" }, BRANDING.emoji, null)).toContain("!\\[x][r] `@\u200bteam");
  });
});

describe("reindent: a suggestion takes the indentation of the line it replaces", () => {
  test("too little or too much indentation becomes the target's", () => {
    expect(reindent('return name.trim().split(" ")[0];', "  ")).toBe('  return name.trim().split(" ")[0];');
    expect(reindent("        return x;", "    ")).toBe("    return x;"); // eight spaces for a four-space line
    expect(reindent("  return x;", "  ")).toBe("  return x;");
  });

  test("a replacement that dedents keeps its shape: the baseline is the replaced block's shared indentation", () => {
    // Python: the replaced lines sit at eight and four spaces, and the replacement keeps that shape.
    const py = ["def total(items):", "    for item in items:", "        if item.skip:", "            continue", "        n += 1", "    return n", ""].join("\n");

    const round: SummaryInput = {
      head_sha: "43504ee000000000000000000000000000000000",
      verdict: "changes",
      why: "x",
      findings: [{ file: "total.py", line: "5-6", severity: "HIGH", lens: "correctness", body: "Counts after the loop.", evidence: { input: "[a]", expected: "1", actual: "0" }, suggestion: "        n = n + 1\n    return n" }],
    };

    const body = renderReview(round, BRANDING.emoji, "H", (p) => (p === "total.py" ? py : null)).comments[0]!.body;

    expect(body).toContain("```suggestion\n        n = n + 1\n    return n\n```");
    expect(reindent("    a\nb", "    ")).toBe("        a\n    b"); // under-indented as a block: shifted together
  });

  test("tabs convert either way, and what each line adds on top of the shared indentation is kept", () => {
    expect(reindent("    return x;", "\t")).toBe("\treturn x;");
    expect(reindent("\t\treturn x;", "  ")).toBe("  return x;");
    expect(reindent("      if (a) {\n        b();\n\n      }", "  ")).toBe("  if (a) {\n    b();\n\n  }");
    expect(reindent("if (a) {\n\tb();\n}", "\t")).toBe("\tif (a) {\n\t\tb();\n\t}");
  });
});

describe("a round reads the shapes models write", () => {
  const base: SummaryInput = { head_sha: "43504ee000000000000000000000000000000000", verdict: "changes", why: "x" };
  const evidenceOf = (evidence: string) => renderSummary({ ...base, findings: [{ file: "a.ts", line: 1, severity: "HIGH", lens: "correctness", body: "b", evidence }] }, BRANDING.emoji, null);

  test("a worked example written as text keeps its three parts, whatever separates them", () => {
    for (const evidence of [
      'Input: "Ada Lovelace" | Expected: "Ada" | Actual: "Lovelace"',
      '**Input:** "Ada Lovelace"\n**Expected:** "Ada"\n**Actual:** "Lovelace"',
      'Expected: "Ada"; Actual: "Lovelace"; Input: "Ada Lovelace"',
      'Given: "Ada Lovelace" → Got: "Lovelace", expected: "Ada"',
    ]) {
      const md = evidenceOf(evidence);

      expect(md).toContain('**Input:** "Ada Lovelace" · **Expected:** "Ada" · **Actual:** "Lovelace"');
      expect(md).toContain("**🟠 HIGH**");
    }

    expect(evidenceOf('Input: "a, b", Expected: "a", Actual: "b"')).toContain('**Input:** "a, b" · **Expected:** "a" · **Actual:** "b"');
    expect(evidenceOf("Input: -1 | Expected: -2 | Actual: -3")).toContain("**Input:** -1 · **Expected:** -2 · **Actual:** -3");
    expect(evidenceOf("Input: -1 -> Expected: -2 - Actual: -3")).toContain("**Input:** -1 · **Expected:** -2 · **Actual:** -3");
    expect(evidenceOf('__Input:__ "__init__" | __Expected:__ "__new__" | __Actual:__ "__init__"')).toContain('**Input:** "__init__" · **Expected:** "__new__" · **Actual:** "__init__"');
    expect(evidenceOf("**Input**: `2 ** 3` | **Expected**: `8` | **Actual**: `6`")).toContain("**Input:** `2 ** 3` · **Expected:** `8` · **Actual:** `6`");
    expect(evidenceOf('Input: "result: 5" | Expected: "5" | Actual: "result: 5"')).toContain('**Input:** "result: 5" · **Expected:** "5" · **Actual:** "result: 5"');
    expect(evidenceOf("Input: f() | Expected: x; | Actual: y;")).toContain("**Input:** f() · **Expected:** x; · **Actual:** y;");
    expect(evidenceOf("Input: f()\nExpected: a,\nActual: b.")).toContain("**Input:** f() · **Expected:** a, · **Actual:** b.");
    expect(evidenceOf(String.raw`Input: "say \"result: ok\"" | Expected: "ok"`)).toContain("_Graded MEDIUM, not HIGH");
    expect(evidenceOf(String.raw`Input: "say \"result: ok\"" | Expected: "ok" | Actual: "say"`)).toContain('**Input:** "say \\"result: ok\\"" · **Expected:** "ok" · **Actual:** "say"');
    expect(evidenceOf("Test uses a regex that only checks the prefix")).toContain("_Graded MEDIUM, not HIGH");
  });

  test("a range written as line and line_end reads as start-end, and a finding without a title takes its first sentence", () => {
    const md = renderSummary({ ...base, findings: [{ file: "a.ts", line: 8, line_end: 10, severity: "LOW", lens: "correctness", body: "firstName crashes on one word. Guard the index." }] }, BRANDING.emoji, null);

    expect(md).toContain("`a.ts:8-10`");
    expect(renderSummary({ ...base, findings: [{ file: "a.ts", line: "8", line_end: "10", severity: "LOW", lens: "correctness", title: "t", body: "b" }] }, BRANDING.emoji, null)).toContain("`a.ts:8-10`");
    expect(md).toContain("**firstName crashes on one word.**");
  });
});

describe("suggestions over code carry code", () => {
  test("advice over code is caught with or without punctuation", () => {
    const replaced = ['    expect(welcomeBack("Ada Lovelace")).toMatch(/^Welcome back, /);'];

    for (const advice of [
      "    Use `expect(welcomeBack('Ada Lovelace')).toBe('Welcome back, Ada!')` for an exact match.",
      "    Use `expect(welcomeBack('Ada Lovelace')).toBe('Welcome back, Ada!')` for an exact match",
      "    Use toBe instead",
      "    You should assert the full greeting",
      "    Consider asserting the whole string",
      "    Replace the regex with an exact match",
    ])
      expect(adviceOverCode("a.test.ts", advice, replaced)).toBe(true);
  });

  test("code, comments and string content are not advice, wherever the string opened", () => {
    const code = ['  return name.trim().split(" ")[0];', "    expect(x).toBe(1);", "  // Use the first word instead", "  # Use the first word instead", "export default class Greeter extends Base {", "  if x is not None and y:", "  for a in items:", "use std::io;"];

    for (const line of code) expect(adviceOverCode("a.ts", line, ["  return x;"])).toBe(false);

    // A template literal's content changes, whole or from inside a literal opened above.
    expect(adviceOverCode("a.ts", "const msg = `\n  Hello world! Use the app instead.\n`;", ["const msg = `", "  hello world", "`;"])).toBe(false);
    expect(adviceOverCode("a.ts", "  Welcome to the app, please sign in", ["  hello world"], "const msg = `")).toBe(false);
    // A docstring line inside triple quotes opened above.
    expect(adviceOverCode("a.py", "    Return the first name of the person.", ["    Return the name."], 'def first(name):\n    """')).toBe(false);
    // An edit that reuses the replaced words is an edit, not advice.
    expect(adviceOverCode("a.ts", "  throw new Error(the message should be clear)", ["  throw new Error(the message)"])).toBe(false);
    // Prose files carry prose.
    expect(adviceOverCode("guide.md", "Use the setup script instead", ["Run setup first."])).toBe(false);
  });

  test("an advice suggestion over code is dropped and the comment kept; over prose it stays", () => {
    const code = ["test(\"x\", () => {", "    expect(welcomeBack(\"Ada Lovelace\")).toMatch(/^Welcome back, /);", "});", ""].join("\n");
    const finding = { file: "a.test.ts", line: 2, severity: "MEDIUM" as const, lens: "correctness", title: "Loose assertion", body: "Only the prefix is checked.", suggestion: "    Use `expect(welcomeBack(\"Ada Lovelace\")).toBe(\"Welcome back, Ada!\")` for an exact match." };
    const round: SummaryInput = { head_sha: "43504ee000000000000000000000000000000000", verdict: "nits", why: "x", findings: [finding] };
    const [comment] = renderReview(round, BRANDING.emoji, "H", (p) => (p === "a.test.ts" ? code : null)).comments;

    expect(comment!.line).toBe(2);
    expect(comment!.body).not.toContain("```suggestion");

    const doc = ["# Guide", "", "Run the setup script first.", ""].join("\n");
    const prose = { ...finding, file: "guide.md", line: 3, suggestion: "Run the setup script before anything else." };
    const docs = renderReview({ ...round, findings: [prose] }, BRANDING.emoji, "H", (p) => (p === "guide.md" ? doc : null)).comments;

    expect(docs[0]!.body).toContain("```suggestion\nRun the setup script before anything else.\n```");

    // A template literal's text, changed inside the literal, posts as a suggestion.
    const literal = ["export const greeting = `", "  hello world", "`;", ""].join("\n");
    const text = { ...finding, file: "greeting.ts", line: 2, suggestion: "  Hello world!" };
    const kept = renderReview({ ...round, findings: [text] }, BRANDING.emoji, "H", (p) => (p === "greeting.ts" ? literal : null)).comments;

    expect(kept[0]!.body).toContain("```suggestion\n  Hello world!\n```");
  });
});

describe("swarm review: titled findings, inline comments and walkthrough", () => {
  const BUG = { file: "src/welcome.ts", line: 9, severity: "HIGH" as const, lens: "correctness", title: "`firstName` returns the second word", body: 'For "Ada Lovelace" it returns "Lovelace", not "Ada". Use index 0.', verified: '`name.trim().split(" ")[1]` at line 9.', evidence: { input: '"Ada Lovelace"', expected: '"Ada"', actual: '"Lovelace"' }, suggestion: '  return name.trim().split(" ")[0];' };
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

  // Two files reviewed with both fixes given on line 9 of each.
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

    // The bug on line 2, the same code already right on line 5: the suggestion stays on the line named.
    const fixed = ["const a = xs[1];", "const b = xs[1];", "", "", "const c = xs[0];"];

    expect(anchorSuggestion(fixed, 2, 2, "const b = xs[0];")).toEqual({ start: 2, end: 2 });
    // Named line not alike, two alike windows near it: ambiguous, dropped.
    expect(anchorSuggestion(["  x();", "a = f(1);", "", "a = f(2);"], 1, 1, "a = f(3);")).toBeNull();

    const unrelated = renderReview({ ...RICH, findings: [{ ...BUG, suggestion: "const nothing = 1;" }] }, BRANDING.emoji, HEADER, read).comments[0]!;

    expect(unrelated.line).toBe(9);
    expect(unrelated.body).not.toContain("```suggestion");
    expect(renderReview({ ...RICH, findings: [{ ...BUG, file: "../../etc/passwd" }] }, BRANDING.emoji, HEADER, () => "x").comments[0]!.body).not.toContain("```suggestion");
  });

  test("links name only threads that exist, convergent needs two lenses, and an unchecked HIGH says so", () => {
    const real = "https://github.com/o/r/pull/1#discussion_r42";
    const fake = "https://github.com/o/r/pull/1#discussion_r6371020510"; // an issue comment's id
    const elsewhere = "https://github.com/other/repo/pull/999#discussion_r42"; // a real id on another PR
    const round = { ...RICH, findings: [{ ...BUG, verified: "", convergent: true, url: fake, reintroduces: real }], still_open: [{ url: fake, title: "firstName (was NIT)" }, { url: real, title: "kept" }, { url: elsewhere, title: "moved" }] };
    const md = renderSummary(round, BRANDING.emoji, null, undefined, undefined, new Set([real]));

    expect(md).toContain("· correctness · **`firstName` returns the second word** · ↩️ [reintroduced](" + real + ") · ⚠️ unverified");
    expect(md).not.toContain("convergent:");
    expect(md).not.toContain(fake);
    expect(md).toContain("- firstName (was NIT)\n- [kept](" + real + ")\n- moved");
    expect(renderReview(round, BRANDING.emoji, HEADER, () => null, new Set([real])).comments[0]!.body).toContain("⚠️ No verifier has checked this yet.");
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

  test("a HIGH with no input and result is graded a suspicion, the verdict never reads milder than its findings, and every unchecked finding says so", () => {
    const hunch = { ...BUG, evidence: undefined, verified: "" };
    const md = renderSummary({ ...RICH, verdict: "good", findings: [hunch, { ...BUG, severity: "MEDIUM" as const, verified: "" }, { ...BUG, lens: "checks/secrets", evidence: undefined, verified: "" }] }, BRANDING.emoji, null);

    expect(md).toContain("**🟡 MEDIUM** · `src/welcome.ts:9` · correctness");
    expect(md).toContain("_Graded MEDIUM, not HIGH: it names no input with the expected and actual result._");
    expect(md).toContain("**🟠 HIGH** · `src/welcome.ts:9` · checks/secrets"); // a check carries its own evidence
    expect(md.match(/⚠️ unverified/g)).toHaveLength(2); // both MEDIUMs, not the check
    expect(md).toContain("## ⚠️ CHANGES NEEDED"); // a HIGH, whatever the round said
    expect(md).toContain("(Raised from LOOKS GOOD: the findings grade it CHANGES NEEDED.)");
    expect(md).toContain('**Input:** "Ada Lovelace" · **Expected:** "Ada" · **Actual:** "Lovelace"');
  });

  test("one confirmed HIGH means changes needed, the router is an expected reviewer, and a lens's take comes from its findings", () => {
    const round = { ...RICH, verdict: "nits" as const, findings: [BUG, { ...BUG, severity: "MEDIUM" as const, file: "src/welcome.test.ts", line: 10 }] };
    expect(renderSummary(round, BRANDING.emoji, null)).toContain("## ⚠️ CHANGES NEEDED");
    expect(renderSummary({ ...RICH, verdict: "good", findings: [{ ...BUG, severity: "MEDIUM" }] }, BRANDING.emoji, null)).toContain("## 💬 APPROVE WITH NITS");

    // The round reported correctness as LOW and left the router out; the fanout listed correctness for this head.
    const fanout = { head_sha: RICH.head_sha, lenses: [{ lens: "correctness", scope: "full" }] };
    const md = renderSummary({ ...round, lenses: [{ lens: "correctness", status: "ok", take: "LOW" }] }, BRANDING.emoji, null, undefined, fanout);
    expect(md).toContain("| correctness |  | full | ok | HIGH (2) |  |"); // correctness tags both findings
    expect(md).toContain("| router |  | full | could_not_run | listed by fanout, no result reported |  |");
    expect(md).toContain("router did not run as its own reviewer, so this round is incomplete.");
    // A lens no finding names keeps the model's own line.
    expect(renderSummary({ ...RICH, lenses: [{ lens: "security", status: "ok", take: "nothing found" }] }, BRANDING.emoji, null)).toContain("| security |  | full | ok | nothing found |  |");
  });

  test("the inline review's marker names the head and its comments, so a new round on the same head posts again", () => {
    const marker = (r: SummaryInput) => /<!-- shepherd-inline @ ([0-9a-f]{7}) ([0-9a-f]{12}) -->/.exec(renderReview(r, BRANDING.emoji, HEADER).body);
    const first = marker(RICH);
    expect(first?.[1]).toBe(RICH.head_sha.slice(0, 7));
    expect(marker(RICH)?.[2]).toBe(first?.[2]); // the same comments: publish skips them
    expect(marker({ ...RICH, findings: [{ ...BUG, line: 10 }] })?.[2]).not.toBe(first?.[2]); // moved: posts again
  });

  test("a round in a neighbouring shape still renders: the words a model borrows from the report and the local record map onto the round's own", () => {
    // The Step 8 report's verdict and keys, the local record's skipped lens, a boolean verified and no why.
    const drifted = {
      head_sha: RICH.head_sha,
      round: 1,
      verdict: "changes_needed",
      counts: { high: 1 },
      posted: { inline: 0 },
      narration: ["[swarm] ..."],
      findings: [{ ...BUG, verified: true }],
      lenses: [
        { lens: "router", status: "skipped", reason: "single lens in fanout, direct dispatch" },
        { lens: "correctness", status: "completed" },
      ],
    };

    const md = renderSummary(drifted, BRANDING.emoji, null);

    expect(md).toContain("## ⚠️ CHANGES NEEDED");
    expect(md).toContain("· ⚠️ unverified"); // `true` is not evidence
    expect(md).toContain("| router |  | full | could_not_run | single lens in fanout, direct dispatch |  |");
    expect(md).toContain("| correctness |  | full | ok | HIGH (1) |  |");
    expect(renderReview(drifted, BRANDING.emoji, HEADER).comments).toHaveLength(1);

    expect(renderSummary({ ...RICH, findings: [], verdict: "APPROVE WITH NITS" }, BRANDING.emoji, null)).toContain("## 💬 APPROVE WITH NITS");
    expect(renderSummary({ ...RICH, findings: [], verdict: "looks-good" }, BRANDING.emoji, null)).toContain("## ✅ LOOKS GOOD");
    expect(() => renderSummary({ ...RICH, verdict: "ship it" }, BRANDING.emoji, null)).toThrow();
  });

  test("a field written as null reads as absent: the round renders with each field's default", () => {
    const nulls = { suggestion: null, evidence: null, url: null, reintroduces: null, title: null, verified: null, checked: null, docs: null, inline: null, convergent: null };
    const round = { ...RICH, why: null, confidence: null, effort: null, diagram: null, findings: [{ ...BUG, ...nulls }] };
    const md = renderSummary(round, BRANDING.emoji, null);

    expect(md).toContain("_Graded MEDIUM, not HIGH: it names no input with the expected and actual result._");
    expect(md).not.toContain("Confidence");
    expect(renderReview(round, BRANDING.emoji, HEADER).comments[0]!.body).not.toContain("```suggestion");
  });

  test("evidence written as one line is split into its parts, and a line that is not one is dropped", () => {
    const md = renderSummary({ ...RICH, findings: [{ ...BUG, evidence: 'Input: "Ada Lovelace", Expected: "Ada", Actual: "Lovelace"' }] }, BRANDING.emoji, null);

    expect(md).toContain('**Input:** "Ada Lovelace" · **Expected:** "Ada" · **Actual:** "Lovelace"');
    expect(md).not.toContain("Graded MEDIUM");
    expect(renderSummary({ ...RICH, findings: [{ ...BUG, evidence: "it is wrong" }] }, BRANDING.emoji, null)).toContain("Graded MEDIUM");
  });

  test("a lens that did not finish leaves the round incomplete, and a line past the end of its file anchors only through its suggestion", () => {
    expect(renderSummary({ ...RICH, lenses: [{ lens: "security", status: "failed" }] }, BRANDING.emoji, null)).toContain("security (failed) did not finish, so its scope was not reviewed.");
    expect(renderReview({ ...RICH, findings: [{ ...BUG, line: 40, suggestion: undefined }] }, BRANDING.emoji, HEADER, read).comments).toHaveLength(0);
    // A cited line past the end of the file: the suggestion matches one line, so the comment moves there.
    const moved = renderReview({ ...RICH, findings: [{ ...BUG, line: 40 }] }, BRANDING.emoji, HEADER, read).comments;
    expect(moved.map((c) => c.line)).toEqual([9]);
    expect(renderReview({ ...RICH, findings: [{ ...BUG, line: 40 }] }, BRANDING.emoji, HEADER).comments).toHaveLength(1); // no file to check against
  });
});
