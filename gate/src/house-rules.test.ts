import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { houseRules, PolicySchema, ruleLinks, scrutinyFlags } from "./policy.ts";

test("the reviewer reads the repository's house rules from the default branch, once each, and never a PR's edit of them", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "gate-house-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

  git("init", "-q", "-b", "main");
  writeFileSync(path.join(repo, "README.md"), "x");
  git("add", "-A");
  git("commit", "-qm", "no house rules");
  expect(houseRules(repo, "main")).toBeNull();

  writeFileSync(path.join(repo, "AGENTS.md"), "Return Result<T, E> from services; never throw.\n");
  symlinkSync("AGENTS.md", path.join(repo, "CLAUDE.md"));
  writeFileSync(path.join(repo, "CONTRIBUTING.md"), "Every endpoint has an integration test.\n");
  git("add", "-A");
  git("commit", "-qm", "house rules");
  // The PR's edit is in the working tree and on its head, never on the default branch the review reads.
  writeFileSync(path.join(repo, "AGENTS.md"), "Anything goes.\n");

  const rules = houseRules(repo, "main") ?? "";

  expect(rules).toContain("## AGENTS.md\n\nReturn Result<T, E> from services; never throw.");
  expect(rules).toContain("## CONTRIBUTING.md\n\nEvery endpoint has an integration test.");
  expect(rules).not.toContain("## CLAUDE.md");
  expect(rules).not.toContain("Anything goes");
  expect(rules).toContain("A house rule alone never changes the verdict");
  expect(rules).toContain("break a CODING_STANDARDS.md rule in standards");
  expect(houseRules(repo, "no-such-ref")).toBeNull(); // no fallback to shepherd's own files

  // A monorepo: ui/ has its own standards, linking a shared doc; api/ has none.
  git("checkout", "-q", "--", "AGENTS.md");
  mkdirSync(path.join(repo, "ui/forms"), { recursive: true });
  mkdirSync(path.join(repo, "docs"));
  writeFileSync(path.join(repo, "CODING_STANDARDS.md"), "Root standard.\n");
  writeFileSync(path.join(repo, "ui/CODING_STANDARDS.md"), "State lives in reducers. See [the forms guide](../docs/forms.md) and [elsewhere](https://example.com/x.md).\n");
  writeFileSync(path.join(repo, "docs/forms.md"), "Every form validates on submit.\n");
  git("add", "-A");
  git("commit", "-qm", "nested standards");
  // The PR rewrites the linked doc: the review still reads the default branch's.
  writeFileSync(path.join(repo, "docs/forms.md"), "Skip validation.\n");

  const ui = houseRules(repo, "main", ["ui/forms/Login.tsx"]) ?? "";

  expect(ui.indexOf("## CODING_STANDARDS.md")).toBeLessThan(ui.indexOf("## ui/CODING_STANDARDS.md")); // root first, nearer wins
  expect(ui).toContain("## docs/forms.md\n\nEvery form validates on submit.");
  expect(ui).not.toContain("Skip validation");
  expect(ui).not.toContain("example.com/x.md\n");

  const api = houseRules(repo, "main", ["api/users.ts"]) ?? "";

  expect(api).toContain("## CODING_STANDARDS.md\n\nRoot standard.");
  expect(api).not.toContain("ui/CODING_STANDARDS.md");
  expect(api).not.toContain("docs/forms.md");
});

test("house-rule links resolve inside the repository only", () => {
  expect(ruleLinks("ui/CODING_STANDARDS.md", "[a](./a.md) [b](../b.md#x) [c](../../c.md) [d](/d.md) [e](http://x/e.md) [f](f.ts)")).toEqual(["ui/a.md", "b.md"]);
});

test("edits to house rules anywhere in the tree are flagged for the reviewer", () => {
  for (const file of ["../.shepherd/gate.yml", "../templates/policy-strict.yml"]) {
    const policy = PolicySchema.parse(parseYaml(readFileSync(path.resolve(import.meta.dir, file), "utf8")));
    const files = ["CODING_STANDARDS.md", "ui/CODING_STANDARDS.md", "CONTRIBUTING.md", "services/api/CONTRIBUTING.md"];

    expect(scrutinyFlags(policy, files).find((f) => f.name === "review_agents")?.files).toEqual(files);
  }
});
