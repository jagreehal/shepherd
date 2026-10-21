// Pinned pack lenses against real GitHub, through gh: the directory fetch, cached reuse, and several processes
// fetching the same lens at once. Skipped when gh is not signed in. Set SHEPHERD_IT_PRIVATE_LENS to
// `owner/repo/<lens dir>@<40-hex sha>` in a private repository to cover a private pack's auth as well.
import { describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Effective, fetchPackLenses, ghFetchDir, lensCache } from "./config.ts";

const signedIn = (() => {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });

    return true;
  } catch {
    return false;
  }
})();

// A lens shipped in shepherd's own public repository, at a fixed commit on its default branch.
const PUBLIC = "jagreehal/shepherd/lenses/observability@6476b73e0941c5abf4d13863bbeb2ae04db78088";

const OFF_MAIN = "978ea77b5f29da7ce43c70494e9488064a44952a";

const policyWith = (ref: string): Effective => ({
  tiers: {},
  ladder: null,
  models: {},
  lenses: { it: { value: { skill: `github:${ref}` }, source: "test", scope: "team" } },
  checks: {},
  fixes: { value: { mode: "suggest" }, source: "test" },
  escalate: null,
  branding: null,
  ci: null,
  recipes: {},
  ignored: [],
});

function fetchesAndReuses(ref: string) {
  const home = mkdtempSync(path.join(tmpdir(), "shepherd-it-"));

  try {
    let calls = 0;

    const counting: typeof ghFetchDir = (...args) => {
      calls++;

      return ghFetchDir(...args);
    };

    fetchPackLenses(policyWith(ref), home, counting);
    fetchPackLenses(policyWith(ref), home, counting);
    const dir = lensCache(home, `github:${ref}`)!;

    expect(readFileSync(path.join(dir, "SKILL.md"), "utf8")).toContain("description:");
    expect(calls).toBe(1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe.skipIf(!signedIn)("pinned pack lenses on GitHub", () => {
  test("a public lens is fetched at its commit and reused from the cache", () => fetchesAndReuses(PUBLIC), 60_000);

  test.skipIf(!process.env.SHEPHERD_IT_PRIVATE_LENS)("a private lens is fetched with gh's credentials", () => fetchesAndReuses(process.env.SHEPHERD_IT_PRIVATE_LENS!), 60_000);

  test("a commit that is not on the pack repository's default branch is refused", () => {
    const home = mkdtempSync(path.join(tmpdir(), "shepherd-it-"));

    try {
      // A parentless commit (tag it-off-default-branch) with main's lens files: GitHub serves it, but it can never
      // be in the default branch's history, which is all a fork's commit has in common with it.
      expect(() => fetchPackLenses(policyWith(`jagreehal/shepherd/lenses/observability@${OFF_MAIN}`), home, ghFetchDir)).toThrow("not on jagreehal/shepherd's main branch");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  test("four processes fetching the same lens at once all succeed and leave one copy", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "shepherd-it-"));

    const script = `import { fetchPackLenses, ghFetchDir } from ${JSON.stringify(path.join(import.meta.dir, "config.ts"))};
fetchPackLenses({ tiers: {}, ladder: null, models: {}, lenses: { it: { value: { skill: ${JSON.stringify(`github:${PUBLIC}`)} }, source: "t", scope: "team" } }, checks: {}, fixes: { value: { mode: "suggest" }, source: "t" }, escalate: null, branding: null, ci: null, recipes: {}, ignored: [] }, ${JSON.stringify(home)}, ghFetchDir);`;

    try {
      const codes = await Promise.all(Array.from({ length: 4 }, () => new Promise<number | null>((resolve) => spawn("bun", ["-e", script], { stdio: "inherit" }).on("exit", resolve))));
      const dir = lensCache(home, `github:${PUBLIC}`)!;

      expect(codes).toEqual([0, 0, 0, 0]);
      expect(readdirSync(path.dirname(dir))).toEqual([path.basename(dir)]);
      expect(readFileSync(path.join(dir, "SKILL.md"), "utf8")).toContain("description:");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 120_000);
});
