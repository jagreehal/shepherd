/**
 * Review accuracy, measured. A case freezes a change (a base/head pair, or the planted-bug demo) with the bugs a person
 * checked by hand, or none for a clean change. A run is one swarm `--local` review of a case under one configuration,
 * kept as the findings its local record holds. A finding is credited to a bug only when it sits near it and its body
 * names the defect, by the bug's `match` patterns, so precision and recall can be compared between configurations
 * instead of judged from single findings.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { buildDemo, demoBugs, finish, git, ReviewRecord, stateDir } from "./local.ts";

const Sha = z.string().regex(/^[0-9a-f]{7,40}$/);

const isRegExp = (r: string) => {
  try {
    new RegExp(r, "i");

    return true;
  } catch {
    return false;
  }
};

const Lines = z.tuple([z.number().int().positive(), z.number().int().positive()]).refine(([a, b]) => a <= b, "lines run start, end");

export const EvalCase = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  split: z.enum(["dev", "heldout"]), // tune skills against dev; read held-out only as totals
  // `repo`: a git URL, or a path from the top of the repository holding the case file ("." for that repository).
  source: z.union([z.object({ demo: z.literal(true) }), z.object({ repo: z.string(), base: Sha, head: Sha })]),
  // Every bug a run should find: how a person confirmed it, every place a finding may anchor on it, and the patterns
  // (case-insensitive regular expressions) one of which a finding's body must contain to name this defect.
  bugs: z.array(
    z.object({
      id: z.string(),
      claim: z.string(),
      checked: z.string().min(1),
      at: z.array(z.object({ file: z.string(), lines: Lines })).min(1),
      match: z.array(z.string().min(1).refine(isRegExp, "not a regular expression")).min(1),
    }),
  ),
  note: z.string().default(""),
});

export type EvalCase = z.infer<typeof EvalCase>;

/** One review of one case: what ran, what it cost, and the findings the local record kept. */
export const EvalRun = z.object({
  case: z.string(),
  config: z.string(),
  run: z.number().int().nonnegative(),
  shepherd: z.string(), // the bundle's version, commit and skills hash: which skill text ran
  agent: z.array(z.string()),
  started_at: z.string(),
  duration_ms: z.number().nonnegative(),
  cost_usd: z.number().nonnegative().nullable(),
  // `finish`'s answer on the record, or `failed` when the agent left none. Only `complete` runs are scored.
  status: z.enum(["complete", "incomplete", "invalid", "failed"]),
  reason: z.string().default(""),
  findings: ReviewRecord.shape.findings.default([]),
});

export type EvalRun = z.infer<typeof EvalRun>;

/** The cases under `dir`, one `case.json` per directory. The demo case takes its bugs from the demo's own list. */
export function loadCases(dir: string): EvalCase[] {
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => path.basename(f) === "case.json");

  const cases = files.map((f) => {
    const c = EvalCase.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8")));

    return "demo" in c.source ? EvalCase.parse({ ...c, bugs: demoBugs().map((b) => ({ id: b.id, claim: b.class, checked: "planted", at: [{ file: b.file, lines: b.lines }], match: b.match })) }) : c;
  });

  const ids = cases.map((c) => c.id);
  const dupe = ids.find((id, i) => ids.indexOf(id) !== i);

  if (dupe) throw new Error(`two cases are called ${dupe}`);

  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

/** Every run file under `dir`, at any depth. */
export function loadRuns(dir: string): EvalRun[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".json") && statSync(path.join(dir, f)).isFile())
    .map((f) => EvalRun.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8"))));
}

const SLACK = 3; // lines either side of a bug a finding may name: reviewers cite the call or the condition beside it

type Finding = EvalRun["findings"][number];

type Bug = EvalCase["bugs"][number];

const near = (f: Finding, bug: Bug) => {
  const line = f.line;

  return line !== "general" && bug.at.some((a) => a.file === f.file && line >= a.lines[0] - SLACK && line <= a.lines[1] + SLACK);
};

const names = (f: Finding, bug: Bug) => bug.match.some((r) => new RegExp(r, "i").test(f.body));

const hits = (f: Finding, bug: Bug) => near(f, bug) && names(f, bug);

/**
 * One run against its case. A finding above NIT counts once: on the first bug it hits that no earlier finding found,
 * as a duplicate when every bug it hits is already found, else as a false positive. A false positive beside a bug that
 * names none of its patterns is also a near miss, worth a person's read. NITs are neither.
 */
export function scoreRun(c: EvalCase, run: EvalRun) {
  const found = new Set<string>();
  let duplicates = 0;
  let falsePositives = 0;
  let nearMisses = 0;
  const actionable = run.findings.filter((f) => f.severity !== "NIT");

  for (const f of actionable) {
    const bug = c.bugs.find((b) => !found.has(b.id) && hits(f, b));

    if (bug) found.add(bug.id);
    else if (c.bugs.some((b) => hits(f, b))) duplicates++;
    else {
      falsePositives++;

      if (c.bugs.some((b) => near(f, b))) nearMisses++;
    }
  }

  return { found: [...found], missed: c.bugs.filter((b) => !found.has(b.id)).map((b) => b.id), duplicates, false_positives: falsePositives, near_misses: nearMisses, actionable: actionable.length };
}

export type ScoreRow = {
  config: string;
  split: EvalCase["split"];
  runs: number;
  not_complete: number; // runs whose record was missing, invalid or incomplete: they find nothing, never a clean review
  coverage: Record<string, number>; // runs per case, so configurations are compared on the same work
  precision: number | null; // bugs found / findings above NIT, over complete runs
  recall: number | null; // bugs found / bugs, over every run: one that did not complete found none
  false_positives: number;
  near_misses: number;
  duplicates: number;
  per_bug: Record<string, number>; // how often each bug was found across every run of its case: 1 always, 0 never
  cost_usd: number | null; // mean per run; null unless every run reported a cost
  duration_ms: number | null;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Totals per configuration and split, pooled over cases and repeats. */
export function scoreRuns(cases: EvalCase[], runs: EvalRun[]): ScoreRow[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const unknown = runs.find((r) => !byId.has(r.case));

  if (unknown) throw new Error(`run of ${unknown.case} has no case`);
  const groups = new Map<string, { config: string; split: EvalCase["split"]; group: EvalRun[] }>();
  const versions = new Map<string, string>();

  for (const r of runs) {
    // Before and after a skill edit under one label would pool into one score that describes neither.
    if ((versions.get(r.config) ?? r.shepherd) !== r.shepherd) throw new Error(`config ${r.config} mixes runs of ${versions.get(r.config)} and ${r.shepherd}: label each version apart`);
    versions.set(r.config, r.shepherd);

    const split = byId.get(r.case)!.split;
    const key = `${r.config}\0${split}`;

    groups.set(key, { config: r.config, split, group: [...(groups.get(key)?.group ?? []), r] });
  }

  return [...groups.values()].map(({ config, split, group }) => {
    const done = group.filter((r) => r.status === "complete");
    const scored = done.map((r) => ({ run: r, c: byId.get(r.case)!, s: scoreRun(byId.get(r.case)!, r) }));
    const found = scored.reduce((n, x) => n + x.s.found.length, 0);
    const bugs = group.reduce((n, r) => n + byId.get(r.case)!.bugs.length, 0);
    const actionable = scored.reduce((n, x) => n + x.s.actionable, 0);
    const perBug: Record<string, number> = {};
    const coverage: Record<string, number> = {};

    for (const r of group) coverage[r.case] = (coverage[r.case] ?? 0) + 1;

    for (const id of Object.keys(coverage).sort()) {
      for (const b of byId.get(id)!.bugs) perBug[`${id}/${b.id}`] = scored.filter((x) => x.c.id === id && x.s.found.includes(b.id)).length / coverage[id]!;
    }

    return {
      config,
      split,
      runs: group.length,
      not_complete: group.length - done.length,
      coverage,
      precision: actionable ? found / actionable : null,
      recall: bugs ? found / bugs : null,
      false_positives: scored.reduce((n, x) => n + x.s.false_positives, 0),
      near_misses: scored.reduce((n, x) => n + x.s.near_misses, 0),
      duplicates: scored.reduce((n, x) => n + x.s.duplicates, 0),
      per_bug: perBug,
      // Unknown, unless every run priced itself: one $0.01 run beside unpriced ones says nothing about the average.
      cost_usd: group.every((r) => r.cost_usd !== null) ? mean(group.map((r) => r.cost_usd!)) : null,
      duration_ms: mean(group.map((r) => r.duration_ms)),
    };
  }).sort((a, b) => a.split.localeCompare(b.split) || (b.recall ?? -1) - (a.recall ?? -1) || (b.precision ?? -1) - (a.precision ?? -1) || a.config.localeCompare(b.config));
}

const NOISE = 0.05; // a recall or precision gap this small between configurations is within run-to-run noise

/** The configuration `pick` recommends, or none, and why. */
export type Choice = { config: string | null; reason: string };

/**
 * The configuration to run: on held-out cases, the cheapest whose recall and precision are both within noise of the
 * best. None, with the reason, unless at least two configurations ran the same cases the same number of times, every
 * run completed, and each reported a cost and a score.
 */
export function pick(rows: ScoreRow[]): Choice {
  const held = rows.filter((r) => r.split === "heldout");
  const none = (reason: string): Choice => ({ config: null, reason });

  if (held.length < 2) return none("needs two or more configurations scored on held-out cases");
  const broken = held.find((r) => r.not_complete);

  if (broken) return none(`${broken.config} has ${broken.not_complete} incomplete run(s): rerun them before comparing`);
  const work = (r: ScoreRow) => JSON.stringify(Object.entries(r.coverage).sort());
  const other = held.find((r) => work(r) !== work(held[0]!));

  if (other) return none(`${held[0]!.config} and ${other.config} reviewed different cases or repeat counts`);
  const unscored = held.find((r) => r.cost_usd === null || r.recall === null || r.precision === null);

  if (unscored) return none(`${unscored.config} has no cost or no score`);
  const bestRecall = Math.max(...held.map((r) => r.recall!));
  const bestPrecision = Math.max(...held.map((r) => r.precision!));
  const close = held.filter((r) => r.recall! >= bestRecall - NOISE && r.precision! >= bestPrecision - NOISE).sort((a, b) => a.cost_usd! - b.cost_usd!);

  if (!close.length) return none("no configuration is within noise of the best on both recall and precision: the trade-off is a person's call");

  return { config: close[0]!.config, reason: `cheapest within ${NOISE} of the best held-out recall and precision` };
}

/** A hash of every file under `dir`: two runs with the same hash ran the same skill text, committed or not. */
export function treeHash(dir: string): string {
  const hash = createHash("sha256");

  for (const f of readdirSync(dir, { recursive: true, encoding: "utf8" }).sort()) {
    const p = path.join(dir, f);

    if (statSync(p).isFile()) hash.update(`${f}\0`).update(readFileSync(p)).update("\0");
  }

  return hash.digest("hex").slice(0, 12);
}

/** A checkout of a case's head, and the base swarm measures the change from. */
export type Prepared = { tree: string; base: string };

/**
 * A fresh copy of the case's head, nothing from any PR in it: no review comments to read, and the base swarm measures
 * from. Git cases clone the repository; the demo builds itself.
 */
export function prepare(c: EvalCase, caseRoot: string, dir: string): Prepared {
  if ("demo" in c.source) return { tree: buildDemo(dir), base: "origin/main" };
  const { repo, base, head } = c.source;
  const from = /^[a-z][a-z0-9+.-]*:\/\//i.test(repo) || repo.startsWith("git@") ? repo : path.resolve(caseRoot, repo);
  const tree = path.join(dir, "repo");

  git(dir, ["clone", "-q", "--no-checkout", from, tree]);

  for (const sha of [base, head]) {
    try {
      git(tree, ["cat-file", "-e", `${sha}^{commit}`]);
    } catch {
      git(tree, ["fetch", "-q", "origin", sha]);
    }
  }

  git(tree, ["checkout", "-q", "--detach", head]);

  return { tree, base };
}

/**
 * Review one prepared case with the agent command (`{base}` and `{head}` in its arguments are filled in) and read back
 * the local record it left. The cost comes from the agent's JSON output when it reports `total_cost_usd`.
 */
export function runCase(c: EvalCase, prepared: Prepared, agent: string[], meta: { config: string; run: number; shepherd: string }): EvalRun {
  const head = "demo" in c.source ? "HEAD" : c.source.head;
  const argv = agent.map((a) => a.replaceAll("{base}", prepared.base).replaceAll("{head}", head));
  const started = new Date();
  const out = spawnSync(argv[0]!, argv.slice(1), { cwd: prepared.tree, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });
  const duration = Date.now() - started.getTime();

  const cost = (() => {
    try {
      return z.object({ total_cost_usd: z.number() }).parse(JSON.parse(out.stdout)).total_cost_usd;
    } catch {
      return null;
    }
  })();

  const recordPath = path.join(stateDir(prepared.tree), "local-record.json");

  const base = { case: c.id, ...meta, agent: argv, started_at: started.toISOString(), duration_ms: duration, cost_usd: cost };

  if (out.error || out.status !== 0) return EvalRun.parse({ ...base, status: "failed", reason: out.error?.message ?? `agent exited ${out.status}` });

  if (!existsSync(recordPath)) return EvalRun.parse({ ...base, status: "failed", reason: "the agent left no local record" });
  const json = readFileSync(recordPath, "utf8");

  try {
    JSON.parse(json);
  } catch (e) {
    return EvalRun.parse({ ...base, status: "invalid", reason: `the local record is not JSON: ${e instanceof Error ? e.message : String(e)}` });
  }

  const checked = finish(prepared.tree, json, prepared.base);
  const record = ReviewRecord.safeParse(JSON.parse(json));

  return EvalRun.parse({ ...base, status: checked.status, reason: [...checked.errors, ...checked.missing].join("; "), findings: record.success ? record.data.findings : [] });
}
