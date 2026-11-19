import { expect, test } from "bun:test";
import { countedLinks, expandIncludes, literalLines, skillBody, subdirApplies, type Blob } from "./review-md.ts";

// The expansion, failing the test when the whole file was dropped.
const expanded = (text: string, read: (file: string) => Blob) => {
  const out = expandIncludes(text, read);

  if ("dropped" in out) throw new Error(out.dropped);

  return out;
};

// An included file as the expansion marks it.
const inc = (name: string, text: string) => `<!-- included file ${name} -->\n${text}\n<!-- end of ${name} -->`;

// Regular files by text; `links` names symlinks by their target.
const files = (entries: Record<string, string>, links: Record<string, string> = {}) => (file: string): Blob =>
  file in links ? { text: links[file]!, mode: "120000" } : file in entries ? { text: entries[file]!, mode: "100644" } : null;

test("a subdirectory REVIEW.md does not apply in or below a test, example, generated or third-party directory", () => {
  expect(subdirApplies("services/billing/REVIEW.md")).toBe(true);
  expect(subdirApplies("integration-tests/REVIEW.md")).toBe(true); // a name matches only as a whole
  expect(subdirApplies("src/Tests/REVIEW.md")).toBe(false); // any case
  expect(subdirApplies("pkg/vendor/lib/REVIEW.md")).toBe(false); // any depth
  expect(subdirApplies("__snapshots__/REVIEW.md")).toBe(false);
});

test("an @ line includes a file beside REVIEW.md, or a .claude or .agents skill's body, in place of the line, marked with its path", () => {
  const skill = "---\nname: api\ndescription: x\n---\nCheck routes.\nRun !`git log` first.\n";
  const out = expanded("# Rules\n\nCap nits at five.\n\n@review-api.md\n@CONVENTIONS\n@.claude/skills/api/SKILL.md\n@.agents/skills/sec/SKILL.md\n", files({ "review-api.md": "Routes have tests.", CONVENTIONS: "No magic numbers.", ".claude/skills/api/SKILL.md": skill, ".agents/skills/sec/SKILL.md": "No PII in logs." }));

  expect(out.text).toContain(`Cap nits at five.\n\n${inc("review-api.md", "Routes have tests.")}\n${inc("CONVENTIONS", "No magic numbers.")}\n<!-- included skill .claude/skills/api/SKILL.md`);
  expect(out.text).toContain("Check routes.\n[a command here is not run in review]\n<!-- end of .claude/skills/api/SKILL.md -->");
  expect(out.text).not.toContain("description: x");
  expect(out.text).toContain("No PII in logs.");
  expect(out.includes).toEqual(["review-api.md", "CONVENTIONS", ".claude/skills/api/SKILL.md", ".agents/skills/sec/SKILL.md"]);
  expect(out.skipped).toEqual([]);
});

test("an @ line stays as text in a block, under a subdirectory, with a space, or naming no file", () => {
  const read = files({ "a.md": "A" });
  const text = "```\n@a.md\n```\n<!-- open\n@a.md\n-->\n<pre>\n@a.md\n</pre>\n@docs/a.md\n@a b.md\n@missing.md";

  expect(expandIncludes(text, read)).toEqual({ text, includes: [], skipped: [] });
  expect(expanded("<!-- closed -->\n@a.md", read).text).toBe(`<!-- closed -->\n${inc("a.md", "A")}`);
});

test("a fence closes only on a bare run of its own character at least as long, so an @ line after a look-alike stays code", () => {
  const read = files({ "guide.md": "GUIDE" });

  expect(expanded("~~~~\n~~~still-in-code\n~~~\n```\n@guide.md\n~~~~\n@guide.md", read).text).toBe(`~~~~\n~~~still-in-code\n~~~\n\`\`\`\n@guide.md\n~~~~\n${inc("guide.md", "GUIDE")}`);
  expect(literalLines("```js\ncode\n````\nprose")).toEqual([true, true, true, false]);
  expect(literalLines("``` not `a fence`\nprose")).toEqual([false, false]); // a backtick in the info string makes it inline code
});

test("a fence ends with the blockquote or list item it opened in, and a fence after a list marker belongs to the item", () => {
  const read = files({ "guide.md": "GUIDE" });

  expect(expanded("> ~~~\n> @guide.md\n\n@guide.md", read).text).toBe(`> ~~~\n> @guide.md\n\n${inc("guide.md", "GUIDE")}`);
  expect(expanded("- ~~~\n  @guide.md\n  ~~~\n@guide.md", read).text).toBe(`- ~~~\n  @guide.md\n  ~~~\n${inc("guide.md", "GUIDE")}`);
  expect(expanded("- ~~~\n  @guide.md\n@guide.md", read).text).toBe(`- ~~~\n  @guide.md\n${inc("guide.md", "GUIDE")}`); // leaving the item closes its fence
  expect(literalLines("- item\n\n      code\n- next\n  ```\n  x\n  ```\nprose")).toEqual([false, false, true, false, true, true, true, false]);
  expect(countedLinks("> ```\n> [a](./a.md)\n\n[b](./b.md)\n- ```\n  [c](./c.md)\n  ```")).toBe(1);
});

test("indented code and HTML blocks are literal; an indented line cannot interrupt a paragraph", () => {
  expect(literalLines("Para\n    still para\n\n    code\n\n    more code\nprose")).toEqual([false, false, false, true, true, true, false]);
  expect(literalLines("<pre>\nx\n</pre>\n<!-- a\nb -->\nprose")).toEqual([true, true, true, true, true, false]);
  expect(literalLines("> ```\n> quoted code\n> ```\n> quoted prose")).toEqual([true, true, true, false]);
});

test("includes past REVIEW.md's limits are skipped whole and reported", () => {
  const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`r${i}.md`, `rule ${i}`]));
  const many = expanded(Object.keys(nine).map((f) => `@${f}`).join("\n"), files(nine));

  expect(many.includes).toHaveLength(8);
  expect(many.skipped).toEqual(["REVIEW.md include r8.md: past 8 included files"]);

  const big = expanded("@big.md\n@.claude/skills/huge/SKILL.md\n@.claude/skills/link/SKILL.md\n@.claude/skills/none/SKILL.md", files({ "big.md": "x".repeat(150_000), ".claude/skills/huge/SKILL.md": "y".repeat(30_001) }, { ".claude/skills/link/SKILL.md": "../x" }));

  expect(big.text).toBe("@big.md\n@.claude/skills/huge/SKILL.md\n@.claude/skills/link/SKILL.md\n@.claude/skills/none/SKILL.md");
  expect(big.skipped).toEqual([
    "REVIEW.md include big.md: REVIEW.md and its includes would reach 150000 bytes",
    "REVIEW.md include .claude/skills/huge/SKILL.md: over 30000 bytes",
    "REVIEW.md include .claude/skills/link/SKILL.md: not a regular file",
    "REVIEW.md include .claude/skills/none/SKILL.md: no such skill",
  ]);

  // The label around an include does not count toward the byte limit: 8 bytes of REVIEW.md and 149,991 of include fit.
  expect(expanded("@fits.md", files({ "fits.md": "x".repeat(149_991) })).includes).toEqual(["fits.md"]);

  const skills = expanded(Array.from({ length: 9 }, () => "@.claude/skills/a/SKILL.md").join("\n"), files({ ".claude/skills/a/SKILL.md": "A" }));

  expect(skills.skipped).toEqual(["REVIEW.md include .claude/skills/a/SKILL.md: past 8 skill lines"]); // a repeated line counts again
});

test("past 64 Markdown links across REVIEW.md and its includes, the whole root file is skipped; skills' links do not count", () => {
  const links = (n: number) => Array.from({ length: n }, (_, i) => `[l](./l${i}.md)`).join(" ");

  expect(countedLinks("[a](https://x) [b](mailto:x) [c](#top) [d](./d.md)")).toBe(1);
  // Indented code and a <pre> block are literal too.
  expect(countedLinks(`Rules.\n\n${links(65).replace(/^/, "    ")}\n\n<pre>\n${links(65)}\n</pre>\n[real](./r.md)`)).toBe(1);
  // A fence quoted or in a list item is code too; a quoted link outside one counts.
  expect(countedLinks(`> \`\`\`md\n${links(65).replace(/^/, "> ")}\n> \`\`\`\n- item\n  \`\`\`\n  [x](./x.md)\n  \`\`\`\n> [quoted](./q.md)`)).toBe(1);
  // Link-shaped text in code or a comment is an example, not a link.
  expect(countedLinks(`\`\`\`md\n${links(65)}\n\`\`\`\n~~~\n[x](./x.md)\n~~~\nSee \`[y](./y.md)\` and <!-- [z](./z.md) --> [real](./r.md)`)).toBe(1);
  expect(expandIncludes(`\`\`\`\n${links(65)}\n\`\`\`\nCap nits.`, files({}))).not.toHaveProperty("dropped");
  expect(expandIncludes(`${links(60)}\n@more.md`, files({ "more.md": links(4) }))).not.toHaveProperty("dropped");
  expect(expandIncludes(`${links(60)}\n@more.md`, files({ "more.md": links(5) }))).toEqual({ dropped: "REVIEW.md: more than 64 Markdown links across it and its includes, so none of it applies" });
  // Nor does it end an indented code block an include opens with.
  expect(expandIncludes("@code.md", files({ "code.md": `    ${links(65)}` }))).not.toHaveProperty("dropped");
  expect(expandIncludes(`${links(64)}\n@.claude/skills/a/SKILL.md`, files({ ".claude/skills/a/SKILL.md": links(10) }))).not.toHaveProperty("dropped");
});

test("a root REVIEW.md that alone reaches the byte limit is skipped whole", () => {
  expect(expandIncludes("x".repeat(150_001), files({}))).toEqual({ dropped: "REVIEW.md: 150001 bytes on its own, past the 150000 it and its includes share, so none of it applies" });
  expect(expandIncludes("x".repeat(149_999), files({}))).not.toHaveProperty("dropped");
});

test("a skill's frontmatter is dropped", () => {
  expect(skillBody("---\nname: a\n---\nBody.")).toBe("Body.");
  expect(skillBody("No frontmatter.")).toBe("No frontmatter.");
});
