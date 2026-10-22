import { describe, expect, test } from "bun:test";
import { BRANDING } from "./config.ts";
import { renderSummary, type SummaryInput } from "./summary.ts";

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

  test("a line, link or reference image from the model cannot break out of its place", () => {
    const bad = (over: Partial<SummaryInput>) => () => renderSummary({ ...ROUND, ...over }, BRANDING.emoji, null);

    expect(bad({ findings: [{ file: "a.ts", line: "3`<img src=x>", severity: "LOW", lens: "x", body: "" }] })).toThrow();
    expect(bad({ still_open: [{ url: "https://github.com/o/r) @team [x](https://evil", title: "t" }] })).toThrow();
    expect(renderSummary({ ...ROUND, why: "![x][r] `@team" }, BRANDING.emoji, null)).toContain("!\\[x][r] `@\u200bteam");
  });
});
