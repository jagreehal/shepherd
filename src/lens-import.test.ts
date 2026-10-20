import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { lensProblems } from "./lens.ts";

const dir = mkdtempSync(path.join(tmpdir(), "shepherd-import-check-"));

const checker = path.resolve(import.meta.dir, "../skills/lens-import/scripts/check-import.mjs");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fixture() {
  const root = mkdtempSync(path.join(dir, "target-"));
  const lens = ".shepherd/lenses/async";
  const folder = path.join(root, lens);

  mkdirSync(path.join(folder, "references"), { recursive: true });
  writeFileSync(path.join(folder, "SKILL.md"), "---\nname: async\ndescription: Review independent async operations for avoidable latency.\nsource: local snapshot\nlicense: MIT\n---\n\n## Review\n\n- **parallel** [note]: Start independent requests together. Flag: independent sequential awaits. Why: latency. [Source](references/parallel.md).\n\n## Fix\n\n- Prefer: existing request helpers.\n");
  writeFileSync(path.join(folder, "references/parallel.md"), "# Independent requests\n\nUse concurrency when neither request depends on the other.\n");

  const report = {
    version: 1,
    root: ".",
    sources: [{ path: "source", license: "MIT" }],
    lenses: [lens],
    rules: [{ id: "parallel", source: "source/rules/parallel.md", disposition: "kept", reason: "Independent target requests", output: { lens, id: "parallel" }, examples: { flags: "Independent sequential fetches", quiet: "The second fetch needs the first response" } }],
  };

  const run = () => {
    const reportFile = path.join(root, "import-report.json");

    writeFileSync(reportFile, JSON.stringify(report));

    return spawnSync("bun", [checker, reportFile], { cwd: root, encoding: "utf8" });
  };

  return { root, folder, report, run };
}

test("an imported lens passes the runtime validator and the installed helper without bundle dependencies", () => {
  const f = fixture();

  expect(lensProblems({ skill: f.report.lenses[0]! }, dir, f.root)).toEqual([]);
  expect(f.run().status).toBe(0);
  const copied = path.join(f.root, "check-import.mjs");

  copyFileSync(checker, copied);
  const result = spawnSync("bun", [copied, path.join(f.root, "import-report.json")], { cwd: f.root, encoding: "utf8" });

  expect(result.status).toBe(0);
});

test("a retained source rule cannot disappear from output, and an output rule cannot escape accounting", () => {
  const f = fixture();

  f.report.rules[0]!.output.id = "missing";
  expect(f.run().stderr).toContain("output rule not found: missing");
  f.report.rules = [];
  expect(f.run().status).toBe(1);
  expect(f.run().stderr).toContain("expected one inventory mapping, got 0");
});

test("the helper rejects a lens Stamp would truncate and accepts the same rules split into lenses", () => {
  const f = fixture();
  const file = path.join(f.folder, "SKILL.md");
  const original = readFileSync(file, "utf8");

  writeFileSync(file, original.replace("Why: latency.", `Why: latency. ${"context ".repeat(700)}`));
  const result = f.run();

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Review exceeds 5500 characters");
  // Restore a bounded first lens and distribute a second retained rule to a second lens.
  writeFileSync(file, original);
  const second = ".shepherd/lenses/async-dependent";
  const secondFolder = path.join(f.root, second);

  mkdirSync(path.join(secondFolder, "references"), { recursive: true });
  writeFileSync(path.join(secondFolder, "SKILL.md"), readFileSync(file, "utf8").replace("**parallel**", "**dependent**"));
  copyFileSync(path.join(f.folder, "references/parallel.md"), path.join(secondFolder, "references/parallel.md"));
  f.report.lenses.push(second);
  f.report.rules.push({ ...f.report.rules[0]!, id: "dependent", output: { lens: second, id: "dependent" } });
  expect(f.run().status).toBe(0);
});

test("bundled sources must resolve their own relative links and stay inside the lens", () => {
  const f = fixture();
  const reference = path.join(f.folder, "references/parallel.md");

  writeFileSync(reference, "See [details](details.md).\n");
  expect(f.run().status).toBe(1);
  expect(f.run().stderr).toContain("missing or nonportable link details.md");
  writeFileSync(path.join(f.folder, "references/details.md"), "The complete rule.\n");
  expect(f.run().status).toBe(0);
  writeFileSync(reference, "See [local checkout](/outside/skill.md).\n");
  expect(f.run().status).toBe(1);
});

test("kept rules require both examples; a justified empty conversion creates no lens", () => {
  const f = fixture();

  f.report.rules[0]!.examples.quiet = "";
  expect(f.run().status).toBe(1);
  expect(f.run().stderr).toContain("violating and valid example");
  const empty = { version: 1, root: ".", sources: [{ path: "deployment-skill" }], lenses: [], rules: [{ id: "deploy", source: "SKILL.md#deploy", disposition: "dropped", reason: "Action workflow; no code-level criterion" }] };
  const report = path.join(f.root, "empty.json");

  writeFileSync(report, JSON.stringify(empty));
  expect(spawnSync("bun", [checker, report], { encoding: "utf8" }).status).toBe(0);
});

test("reference-style source links resolve locally, including links inside bundled excerpts", () => {
  const f = fixture();
  const file = path.join(f.folder, "SKILL.md");

  writeFileSync(file, `${readFileSync(file, "utf8").replace("[Source](references/parallel.md)", "[Source][original]")}\n[original]: references/parallel.md\n`);
  const excerpt = path.join(f.folder, "references/parallel.md");

  writeFileSync(excerpt, "Use [details][criteria].\n\n[criteria]: details.md\n");
  expect(f.run().status).toBe(1);
  expect(f.run().stderr).toContain("missing or nonportable link details.md");
  writeFileSync(path.join(f.folder, "references/details.md"), "Independent requests only.\n");
  expect(f.run().status).toBe(0);
});
