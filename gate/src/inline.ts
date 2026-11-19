// Pins a finding to the line it names. GitHub takes a review comment on a line inside a diff hunk, so gate checks each
// anchor against the diff before sending it. The review body lists every issue, anchored or not.
import path from "node:path";
import type { Verdict } from "./github.ts";
import { STANDARDS_FILE, type HouseRule } from "./house-rules.ts";
import { diffSectionPath } from "./reviewer.ts";

/** A finding on a line of the head's side of the diff. */
export type Anchored = { path: string; line: number; body: string };

const MAX_ANCHORS = 25;

/** Line comments kept for coding-standard breaches however many blocking issues a review raises. */
const STANDARD_SLOTS = 10;

/** The longest title a line comment shows before it falls back to the opening words. */
const TITLE_MAX = 100;

/** The new-side lines of a section GitHub accepts a comment on: added and context lines, inside a hunk. */
export function commentableLines(section: string): Set<number> {
  const lines = new Set<number>();
  let next = 0;
  let inHunk = false;

  for (const l of section.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);

    if (hunk) {
      next = Number(hunk[1]);
      inHunk = true;
    } else if (inHunk && (l[0] === "+" || l[0] === " ")) lines.add(next++);
  }

  return lines;
}

/** The new-side lines a diff adds, by file on the head: where a push changed the code. */
export function addedLines(diff: string): Map<string, Set<number>> {
  return sectionMap(diff, (section) => {
    const lines = new Set<number>();
    let next = 0;

    for (const l of section.split("\n")) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);

      if (hunk) next = Number(hunk[1]);
      else if (l[0] === "+" && !l.startsWith("+++")) lines.add(next++);
      else if (l[0] === " ") next++;
    }

    return lines;
  });
}

/** Each file's commentable lines, by its path on the head: a section's `+++` line when it has one, for a rename's new name. */
function commentableMap(diff: string): Map<string, Set<number>> {
  return sectionMap(diff, commentableLines);
}

function sectionMap(diff: string, lines: (section: string) => Set<number>): Map<string, Set<number>> {
  const sections = diff.split(/^(?=diff --git )/m).filter((s) => s.startsWith("diff --git "));

  return new Map(
    sections.flatMap((s) => {
      const firstHunk = s.search(/^@@/m);
      const meta = firstHunk < 0 ? s : s.slice(0, firstHunk);
      const head = /^\+\+\+ b\/(.+)$/m.exec(meta)?.[1]?.replace(/\t$/, "") ?? diffSectionPath(s);

      return head ? [[head, lines(s)] as const] : [];
    }),
  );
}

/** The `file:line` an issue opens with, as the verdict schema asks; null when it opens with anything else. */
export function issueAnchor(issue: string): { path: string; line: number } | null {
  const m = /^[\s*_`"']*(?:\.\/)?([^\s:*`"']+):(\d+)/.exec(issue);

  return m ? { path: m[1]!, line: Number(m[2]) } : null; // SAFETY: both groups are mandatory in the match
}

/** The issues that open with a line inside the diff, ready to post. The rest stay in the review body alone. */
export function anchoredIssues(issues: string[], diff: string): Anchored[] {
  const map = commentableMap(diff);

  return issues.flatMap((body) => {
    const at = issueAnchor(body);

    return at && map.get(at.path)?.has(at.line) ? [{ ...at, body }] : [];
  }).slice(0, MAX_ANCHORS);
}

// The `file:line` an issue opens with, and the separator after it.
const LOCATION = /^[\s*_`"']*(?:\.\/)?[^\s:*`"']+:\d+(?:-\d+)?[*_`"']*\s*[-:—–]?\s*/;

/** A REVIEW.md breach as the reviewer reports it: the rule's source path, and the finding that posts. */
export type Standard = { source: string; finding: string };

/**
 * Only a breach whose finding opens with a changed file's `file:line`, and whose source is a STANDARDS_FILE the review
 * applied in a directory above that file, or a file the root one includes, stays in standards, the list that posts as
 * line comments. Any other becomes a note.
 */
export function reviewFileStandards<T extends { notes: string[]; standards: Standard[] }>(llm: T, rules: HouseRule[]): T {
  const scoped = rules.filter((r) => !r.linked && path.posix.basename(r.file) === STANDARDS_FILE);

  const posts = ({ source, finding }: Standard) => {
    const at = issueAnchor(finding);
    const cited = path.posix.normalize(source.trim());

    return !!at && scoped.some((r) => {
      const dir = path.posix.dirname(r.file);

      return (dir === "." || at.path.startsWith(`${dir}/`)) && [r.file, ...(r.includes ?? [])].includes(cited);
    });
  };

  return { ...llm, standards: llm.standards.filter(posts), notes: [...llm.notes, ...llm.standards.filter((s) => !posts(s)).map((s) => s.finding)] };
}

/**
 * An anchored issue as its comment reads: the grade, a short title, then the rest. The comment sits on the line, so the
 * text drops the `file:line` it opened with: after a later push GitHub moves the comment, and the number would not
 * match. `clean` makes model text safe to post.
 */
export function inlineBody(issue: string, grade: string, clean: (text: string) => string): string {
  const text = issue.replace(LOCATION, "").trim();
  // The title ends at the first sentence break or spaced dash: models separate a title either way.
  const end = /(?<=[.!?;:])\s|\s[–—-]\s|\n/.exec(text);
  const clause = (end ? text.slice(0, end.index) : text).replace(/[.;:]$/, "");

  if (clause.length <= TITLE_MAX) {
    const rest = end ? text.slice(end.index).replace(/^[\s.;:,–—-]+/, "") : "";

    return [`${grade} · **${clean(clause)}**`, ...(rest ? ["", clean(rest)] : [])].join("\n");
  }

  // A first clause too long to scan gives its opening words as the title, and the text stays whole below it.
  const cut = clause.slice(0, TITLE_MAX - 1);

  return `${grade} · **${clean(`${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cut.length).replace(/[\s,;:–—-]+$/, "")}…`)}**\n\n${clean(text)}`;
}

/**
 * The line comments a review posts. Blocking issues post only on a refusal or an escalation. A coding-standard breach
 * posts on any finished review, approval included, so triage can fix it; as an open thread it holds the check until then.
 */
export function lineComments(verdict: Verdict, llm: { issues: string[]; standards: Standard[] } | null | undefined, diff: string, grades: { blocking: string; standard: string }, clean: (text: string) => string): Anchored[] {
  if (verdict === "ERROR" || !llm) return [];

  const anchor = (items: string[], grade: string) => anchoredIssues(items, diff).map((a) => ({ ...a, body: inlineBody(a.body, grade, clean) }));

  const standards = anchor(llm.standards.map((s) => s.finding), grades.standard);
  // Leave STANDARD_SLOTS for standards so a busy refusal still posts them for triage.
  const blocking = verdict === "APPROVED" ? [] : anchor(llm.issues, grades.blocking).slice(0, MAX_ANCHORS - Math.min(standards.length, STANDARD_SLOTS));

  return [...blocking, ...standards].slice(0, MAX_ANCHORS);
}
