import { afterAll, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, story, test } from "executable-stories-bun";
import { buildDemo, captureChange, finish, receiptStatus, type LocalChange, type ReviewRecord } from "./local.ts";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const scratch = (prefix: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));

  dirs.push(dir);

  return dir;
};

/** A record a full swarm run would write: every stage ok, the router on the full change. */
const fullReview = (change: LocalChange, findings: ReviewRecord["findings"]): ReviewRecord => ({
  fingerprint: change.fingerprint,
  stages: [
    { stage: "checks", status: "ok" },
    { stage: "router", status: "ok" },
    { stage: "verify", status: "ok" },
  ],
  lenses: [{ lens: "router", status: "ok", scope: "full" }],
  candidates: [],
  findings,
});

describe("local review receipts", () => {
  test("a shepherd fix invalidates the previous review receipt", () => {
    story.init({ ticket: "src/local.ts", covers: ["src/local.ts"] });

    story.given("a complete local review of the change left a receipt");
    const app = buildDemo(path.join(scratch("shepherd-story-"), "demo"));
    const reviewed = captureChange(app);
    const record = fullReview(reviewed, [{ file: "src/search.ts", line: 7, severity: "CRITICAL", lens: "security/sql-injection", body: "Bind term as a parameter." }]);

    expect(finish(app, JSON.stringify(record)).status).toBe("complete");
    expect(receiptStatus(app).status).toBe("reviewed");

    story.when("shepherd fixes the finding by editing the reviewed file");
    const search = path.join(app, "src", "search.ts");

    writeFileSync(search, readFileSync(search, "utf8").replace("LIKE '%${term}%'", "LIKE ?").replace("LIMIT ${limit}`)", "LIMIT ${limit}`, [`%${term}%`])"));

    story.then("the receipt no longer covers the change on disk");
    expect(receiptStatus(app)).toMatchObject({ status: "changed" });
    expect(captureChange(app).fingerprint).not.toBe(reviewed.fingerprint);

    story.and("the earlier review cannot be finished again for the fixed content");
    expect(finish(app, JSON.stringify(record)).missing).toContain("the change moved during the review: capture it again and re-run");
  });
});

// The rule in references/stories.md: a baseline run before the fix and a run after it, judged by `executable-stories goal`.
const cli = path.join(import.meta.dir, "..", "node_modules", ".bin", "executable-stories");

/** Run one story file under `bun test` with the executable-stories preload; return the raw run's path. */
function storyRun(skipped: boolean): string {
  const dir = scratch("shepherd-goal-");
  const adapter = path.dirname(Bun.resolveSync("executable-stories-bun", import.meta.dir));
  const register = skipped ? "test.skip" : "test";

  writeFileSync(path.join(dir, "bunfig.toml"), `[test]\npreload = [${JSON.stringify(path.join(adapter, "preload.js"))}]\n`);
  writeFileSync(
    path.join(dir, "search.story.test.ts"),
    `import { expect } from "bun:test";
import { story, test } from ${JSON.stringify(path.join(adapter, "index.js"))};
${register}("search binds the term as a parameter", () => {
  story.init();
  story.given("a search for a quote");
  story.then("the term reaches the query as a parameter");
  expect(["%'%"]).toEqual(["%'%"]);
});
`,
  );
  Bun.spawnSync(["bun", "test"], { cwd: dir, stdout: "ignore", stderr: "ignore" });

  return path.join(dir, ".executable-stories", "raw-run.json");
}

describe("verification after a fix", () => {
  test("a scenario skipped after a fix cannot count as successful verification", () => {
    story.init({ ticket: "skills/shepherd/references/stories.md" });

    story.given("the scenario passed in the run before the fix");
    const before = storyRun(false);

    story.when("the run after the fix skips that scenario");
    const after = storyRun(true);

    story.then("the goal is not met against the pre-fix baseline");
    const goal = Bun.spawnSync([cli, "goal", after, "--baseline", before, "--goal-format", "json"]);
    const report = JSON.parse(goal.stdout.toString());

    expect(goal.exitCode).toBe(5);
    expect(report.met).toBe(false);

    story.and("the ratchet names the scenario as disabled, passed to skipped");
    expect(report.ratchet.violations).toContainEqual(expect.objectContaining({ title: "search binds the term as a parameter", kind: "disabled", detail: "passed -> skipped" }));
  });
});
