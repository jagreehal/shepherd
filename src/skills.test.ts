import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundledSkills, install, MARKER, uninstall } from "./install.ts";
import { addLens, catalog, globalLensFile, readLenses, repoLensFile, resolveSkill, skillDescription } from "./lens.ts";

const ROOT = path.resolve(import.meta.dir, "..");

const SKILLS = path.join(ROOT, "skills");

const names = bundledSkills(SKILLS);

const markdownFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);

    if (d.isDirectory()) return markdownFiles(p);

    return d.name.endsWith(".md") ? [p] : [];
  });

const frontmatter = (text: string) => /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";

describe("skill pack", () => {
  test("ships the loop, its runners, the ladder and every lens", () => {
    expect(names).toEqual(["ci-repair", "pair", "review-correctness", "review-maintainability", "review-security", "review-simplicity", "review-slop", "shepherd", "swarm", "triage"]);
  });

  test.each(names)("%s: frontmatter name matches its directory and has a description within the 1024-char limit", (name) => {
    const fm = frontmatter(readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8"));
    expect(/^name: (.+)$/m.exec(fm)?.[1]).toBe(name);

    const description = fm.split(/^description:/m)[1]?.replace(/\s+/g, " ").replace(/^ >/, "").trim() ?? "";
    expect(description.length).toBeGreaterThan(40);
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  test("every relative file a skill points at exists", () => {
    const missing: string[] = [];

    for (const file of markdownFiles(SKILLS)) {
      for (const [, ref] of readFileSync(file, "utf8").matchAll(/`((?:\.\.\/[\w-]+\/)?(?:references\/)?[\w.-]+\.md)`/g)) {
        if (!ref || !ref.includes("/")) continue;

        // Paths are written relative to the skill directory, from SKILL.md and from its references alike.
        const skillDir = path.join(SKILLS, path.relative(SKILLS, file).split(path.sep)[0] ?? "");

        if (!existsSync(path.resolve(skillDir, ref))) missing.push(`${path.relative(ROOT, file)} -> ${ref}`);
      }
    }

    expect(missing).toEqual([]);
  });

  test("every JSON contract a runner returns parses", () => {
    for (const name of ["swarm", "triage", "ci-repair"]) {
      const blocks = [...readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8").matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
      expect(blocks.length).toBeGreaterThan(0);

      for (const block of blocks) expect(() => JSON.parse(block)).not.toThrow();
    }
  });

  test("swarm labels its comments with the exact text triage detects", () => {
    const swarm = readFileSync(path.join(SKILLS, "swarm", "SKILL.md"), "utf8");
    const triage = readFileSync(path.join(SKILLS, "triage", "SKILL.md"), "utf8");
    expect(swarm).toContain("> 🤖 Automated comment by **Shepherd swarm**, not written by a human");
    expect(triage).toContain('contains("🤖 Automated comment by")');
  });

  test("triage and shepherd read stamp's verdict heading the way stamp writes it", () => {
    const heading = /\^## \\\\S\+ stamp: /;
    expect(readFileSync(path.join(SKILLS, "triage", "SKILL.md"), "utf8")).toMatch(heading);
    expect(readFileSync(path.join(SKILLS, "shepherd", "SKILL.md"), "utf8")).toMatch(heading);
    expect("## ✅ stamp: APPROVED").toMatch(/^## \S+ stamp: /);
  });
});

describe("installer", () => {
  const fresh = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "shepherd-install-"));

    return { skills: path.join(dir, "skills"), commands: path.join(dir, "commands") };
  };

  test("copies every skill with a marker, and the command, then replaces its own copies on reinstall", () => {
    const t = fresh();
    const first = install(ROOT, t.skills, t.commands, false, false);
    expect(first.every((o) => o.action === "installed")).toBe(true);
    expect(existsSync(path.join(t.skills, "swarm", "references", "formats.md"))).toBe(true);
    expect(existsSync(path.join(t.skills, "swarm", MARKER))).toBe(true);
    expect(lstatSync(path.join(t.commands, "shepherd.md")).isSymbolicLink()).toBe(false);

    expect(install(ROOT, t.skills, t.commands, false, false).every((o) => o.action === "replaced")).toBe(true);
  });

  test("leaves a skill it did not install alone unless forced", () => {
    const t = fresh();
    mkdirSync(path.join(t.skills, "triage"), { recursive: true });
    writeFileSync(path.join(t.skills, "triage", "SKILL.md"), "someone else's triage");

    expect(install(ROOT, t.skills, null, false, false).find((o) => o.name === "triage")?.action).toBe("skipped");
    expect(readFileSync(path.join(t.skills, "triage", "SKILL.md"), "utf8")).toBe("someone else's triage");

    expect(install(ROOT, t.skills, null, false, true).find((o) => o.name === "triage")?.action).toBe("replaced");
    expect(existsSync(path.join(t.skills, "triage", MARKER))).toBe(true);
  });

  test("links into the bundle with --link", () => {
    const t = fresh();
    install(ROOT, t.skills, t.commands, true, false);
    expect(lstatSync(path.join(t.skills, "shepherd")).isSymbolicLink()).toBe(true);
    expect(lstatSync(path.join(t.commands, "shepherd.md")).isSymbolicLink()).toBe(true);
  });

  test("uninstall removes only what it installed", () => {
    const t = fresh();
    install(ROOT, t.skills, t.commands, false, false);
    mkdirSync(path.join(t.skills, "mine"));

    const outcomes = uninstall(ROOT, t.skills, t.commands);
    expect(outcomes.every((o) => o.action === "removed")).toBe(true);
    expect(readdirSync(t.skills)).toEqual(["mine"]);
    expect(readdirSync(t.commands)).toEqual([]);
  });
});

describe("custom lenses", () => {
  const sandbox = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "shepherd-lens-"));
    const home = path.join(dir, "home");
    const repo = path.join(dir, "repo");

    const skill = (root: string, name: string, description: string) => {
      mkdirSync(path.join(root, name), { recursive: true });
      writeFileSync(path.join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: >\n  ${description}\n---\n\n# ${name}\n`);
    };

    return { home, repo, skill };
  };

  test("finds a skill by name in the usual skills directories, or by path in the repository", () => {
    const { home, repo, skill } = sandbox();
    skill(path.join(home, ".claude", "skills"), "react-rules", "React rules");
    skill(path.join(repo, "tools", "lenses"), "api-style", "API style");

    expect(resolveSkill("react-rules", home, repo)).toBe(path.join(home, ".claude", "skills", "react-rules"));
    expect(resolveSkill("tools/lenses/api-style", home, repo)).toBe(path.join(repo, "tools", "lenses", "api-style"));
    expect(resolveSkill("nowhere", home, repo)).toBeNull();
    expect(skillDescription(path.join(home, ".claude", "skills", "react-rules"))).toBe("React rules");
  });

  test("adds a lens without disturbing the others, and the repository wins on a clash", () => {
    const { home, repo } = sandbox();
    addLens(repoLensFile(repo), "react", { skill: "react-rules", applies_to: ["**/*.tsx"] });
    addLens(repoLensFile(repo), "api", { skill: "tools/lenses/api-style" });
    addLens(globalLensFile(home), "react", { skill: "my-react" });
    addLens(globalLensFile(home), "copy", { skill: "copy-rules" });

    expect(Object.keys(readLenses(repoLensFile(repo)))).toEqual(["react", "api"]);
    expect(catalog(home, repo)).toEqual({
      react: { skill: "react-rules", applies_to: ["**/*.tsx"] },
      copy: { skill: "copy-rules" },
      api: { skill: "tools/lenses/api-style" },
    });
  });

  test.each([
    ["a built-in lens name", "security"],
    ["an invalid name", "React Rules"],
  ])("refuses %s", (_, name) => {
    const { repo } = sandbox();
    expect(() => addLens(repoLensFile(repo), name, { skill: "x" })).toThrow();
  });

  test("rejects a lens file with keys swarm would not understand", () => {
    const { repo } = sandbox();
    mkdirSync(path.join(repo, ".shepherd"), { recursive: true });
    writeFileSync(repoLensFile(repo), "lenses:\n  react:\n    skill: x\n    run_on_every_file: true\n");
    expect(() => readLenses(repoLensFile(repo))).toThrow();
  });
});
