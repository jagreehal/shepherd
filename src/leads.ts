// Impact leads: where a change may reach beyond its diff. Changed exports and the files outside the PR that name
// them, the test files that sit beside each changed source file, and the lines still naming an identifier the diff
// renamed or removed. Advisory context only: a lead says where to look, it never stands in for reading the diff, and
// nothing here gates.
import { execFileSync } from "node:child_process";
import { GENERATED } from "./diff.ts";

export type Reference = { file: string; line: number; text: string };

export type Leads = {
  /** An exported name the diff adds, removes or rewrites, and up to MAX_CALLERS files outside the PR that name it. */
  symbols: { name: string; callers: string[] }[];
  /** Changed source files with the test files that match their name; `tests` is empty when none does. */
  sources: { file: string; tests: string[] }[];
  /**
   * Identifiers whose count the diff changes, and lines it left alone that still name them, docs included: a rename or
   * removal's stale references. `count` is every such line; `refs` the first MAX_REFERENCES.
   */
  references: { name: string; removed: boolean; count: number; refs: Reference[] }[];
};

const MAX_SYMBOLS = 8;

const MAX_CALLERS = 5;

const MAX_SOURCES = 10;

const MAX_CANDIDATES = 24;

const MAX_ATOMS = 12;

const MAX_REFERENCES = 6;

const MAX_EXCERPT = 160;

// A declaration's name on a diff line: TS/JS exports, Python top-level defs and classes, Go exported funcs.
const DECLARATION = [
  /^[+-]\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^[+-](?:def|class)\s+([A-Za-z_]\w*)/,
  /^[+-]func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/,
];

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb)$/;

const TEST_FILE = /(^|\/)(__tests__\/|tests?\/)|[._-](test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.go$/;

/** The names the diff's hunk lines declare, in order of first appearance, at most MAX_SYMBOLS. */
export function changedSymbols(diff: string): string[] {
  const names = new Set<string>();
  let inHunk = false;

  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) inHunk = false;
    else if (l.startsWith("@@")) inHunk = true;
    else if (inHunk)
      for (const re of DECLARATION) {
        const name = re.exec(l)?.[1];

        if (name && name.length > 2) names.add(name);
      }
  }

  return [...names].slice(0, MAX_SYMBOLS);
}

type AtomChange = { atom: string; confidence: number; added: number; removed: number };

/** Identifier-shaped and specific enough to search for: mixed case or an underscore, four characters or more. */
const searchable = (atom: string) => atom.length >= 4 && atom.length <= 128 && /[A-Z_]/.test(atom);

/** How sure the text around a name is that it names a symbol: a declaration, a binding or call, a quoted or dotted use, a bare word. */
function confidence(text: string, atom: string, at: number): number {
  const before = text.slice(Math.max(0, at - 64), at);
  const after = text.slice(at + atom.length, at + atom.length + 16);

  if (/\b(?:class|interface|type|enum|function|def|func|fn|struct|trait)\s+$/.test(before)) return 4;

  if (/\b(?:const|let|var)\s+$/.test(before) || /^\s*\??\s*[:(]/.test(after)) return 3;

  return (/['"`]$/.test(before) && /^['"`]/.test(after)) || before.endsWith(".") || after.startsWith(".") || atom.includes("_") ? 2 : 1;
}

/**
 * Identifiers whose count the diff changes, surest first, and the added lines to leave out of the search. A name on as
 * many added lines as removed moved or stayed; a rename shows as one name's count falling and another's rising. Names
 * the diff removes rank first.
 */
export function changedAtoms(diff: string) {
  const changes = new Map<string, AtomChange>();
  const added = new Set<string>();
  let file = "";
  let at = 0;
  let [oldLeft, newLeft] = [0, 0];

  const record = (text: string, side: "added" | "removed") => {
    for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      if (!searchable(m[0])) continue;
      const c = changes.get(m[0]) ?? { atom: m[0], confidence: 0, added: 0, removed: 0 };

      c.confidence = Math.max(c.confidence, confidence(text, m[0], m.index));
      c[side]++;
      changes.set(m[0], c);
    }
  };

  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) [oldLeft, newLeft] = [0, 0];

    if (oldLeft > 0 || newLeft > 0) {
      if (l.startsWith("+")) {
        added.add(`${file}\0${at}`);
        record(l.slice(1), "added");
        at++;
        newLeft--;
      } else if (l.startsWith("-")) {
        record(l.slice(1), "removed");
        oldLeft--;
      } else if (!l.startsWith("\\")) {
        at++;
        oldLeft--;
        newLeft--;
      }

      continue;
    }

    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);

    if (hunk) [oldLeft, at, newLeft] = [Number(hunk[1] ?? 1), Number(hunk[2]), Number(hunk[3] ?? 1)];
    else if (l.startsWith("+++ b/")) file = l.slice(6).replace(/\t$/, "");
  }

  const atoms = [...changes.values()]
    .filter((c) => c.added !== c.removed)
    .sort((a, b) => b.confidence - a.confidence || Number(b.removed > 0) - Number(a.removed > 0) || Math.abs(b.added - b.removed) - Math.abs(a.added - a.removed) || b.atom.length - a.atom.length || (a.atom < b.atom ? -1 : 1))
    .slice(0, MAX_CANDIDATES);

  return { atoms, added };
}

/** A file's language, so a TypeScript source never claims a Go test: JS and TS share one, any other extension is its own. */
const family = (f: string) => {
  const ext = /\.([^./]+)$/.exec(f)?.[1] ?? "";

  return /^[cm]?[jt]sx?$/.test(ext) ? "js" : ext;
};

/** Tracked test files whose name matches the source file's stem: `a.ts` → `a.test.ts`, `__tests__/a.ts`, `test_a.py`, `a_test.go`. */
export function relatedTests(file: string, tracked: string[]): string[] {
  const stem = file.split("/").at(-1)!.replace(/\.[^.]+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(`(^|/)(test_)?${stem}([._-](test|spec))?\\.[^/]+$|(^|/)${stem}_test\\.go$`);

  const lang = family(file);

  return tracked.filter((t) => t !== file && TEST_FILE.test(t) && named.test(t) && family(t) === lang);
}

export type LeadDeps = {
  /** Tracked files, `git ls-files`. */
  tracked: () => string[];
  /** Tracked files naming `word` as a whole word, `git grep -lw`. */
  naming: (word: string) => string[];
  /** The lines of tracked text files naming `word` as a whole word, `git grep -nw`. */
  lines: (word: string) => Reference[];
};

export function impactLeads(diff: string, changed: string[], deps: LeadDeps): Leads {
  const inPR = new Set(changed);
  const tracked = deps.tracked();
  const { atoms, added } = changedAtoms(diff);

  const references = atoms.flatMap((a) => {
    const refs = deps.lines(a.atom).filter((r) => !GENERATED.test(r.file) && !added.has(`${r.file}\0${r.line}`));

    return refs.length ? [{ name: a.atom, removed: a.removed > a.added, count: refs.length, refs: refs.slice(0, MAX_REFERENCES).map((r) => ({ ...r, text: r.text.trim().slice(0, MAX_EXCERPT) })) }] : [];
  });

  return {
    references: references.slice(0, MAX_ATOMS),
    // A caller is code: a doc or changelog that mentions the name is not one.
    symbols: changedSymbols(diff).map((name) => ({ name, callers: deps.naming(name).filter((f) => !inPR.has(f) && SOURCE.test(f) && !GENERATED.test(f)).slice(0, MAX_CALLERS) })),
    sources: changed
      .filter((f) => !TEST_FILE.test(f) && SOURCE.test(f) && !GENERATED.test(f))
      .slice(0, MAX_SOURCES)
      .map((file) => ({ file, tests: relatedTests(file, tracked).slice(0, 3) })),
  };
}

/** Leads over a checkout, through git: no PR code runs. Null when git fails, so the prompt simply goes without. */
export function leadsAt(root: string, diff: string, changed: string[]): Leads | null {
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", ["-C", root, "-c", "core.fsmonitor=false", ...args], { encoding: "utf8", maxBuffer: 16 << 20, stdio: ["ignore", "pipe", "ignore"] });
    } catch (e) {
      // git grep exits 1 for "no matches", which is an answer.
      if (e instanceof Error && "status" in e && e.status === 1) return "";
      throw e;
    }
  };

  // -z: paths as they are, NUL-separated. Without it git quotes a path holding a tab, a quote or non-ASCII bytes
  // (`"src/caf\303\251.ts"`), and the quoted name matches neither the PR's files nor a test's.
  const paths = (s: string) => s.split("\0").filter(Boolean);

  // -z prints path NUL line NUL text, one match per newline.
  const lines = (w: string) =>
    git("grep", "-nwFIz", "-e", w, "--")
      .split("\n")
      .flatMap((l) => {
        const [file, line, text] = l.split("\0");

        return file && line && text !== undefined ? [{ file, line: Number(line), text }] : [];
      });

  try {
    return impactLeads(diff, changed, { tracked: () => paths(git("ls-files", "-z")), naming: (w) => paths(git("grep", "-lwFz", "--", w)), lines });
  } catch {
    return null;
  }
}

/** The leads for the prompt: one line each, names passed through `clean` by the caller. */
export function formatLeads(leads: Leads, clean: (s: string) => string): string[] {
  const symbols = leads.symbols.map((s) => `${clean(s.name)}: ${s.callers.length ? `named in ${s.callers.map(clean).join(", ")}` : "named nowhere outside this PR"}`);
  const sources = leads.sources.map((s) => `${clean(s.file)}: ${s.tests.length ? `tests in ${s.tests.map(clean).join(", ")}` : "no test file matches its name"}`);

  const references = leads.references.map((r) => {
    const shown = r.refs.map((x) => `${clean(x.file)}:${x.line} ${JSON.stringify(clean(x.text))}`).join("; ");

    return `${clean(r.name)}: ${r.removed ? "fewer uses after this diff, still" : "more uses after this diff, also"} named on ${r.count} unchanged line${r.count === 1 ? "" : "s"}: ${shown}`;
  });

  return [...symbols, ...sources, ...references];
}
