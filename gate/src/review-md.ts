// REVIEW.md as Claude Code Review reads it, so one file steers both reviewers: `@` includes in the root file, the
// subdirectories whose REVIEW.md does not apply, and the limits on both. Skill includes take `.agents/skills/` too, so a
// team whose agents are not Claude keeps its skills where those agents read them.

/** A subdirectory REVIEW.md in or below one of these (whole name, any case, any depth) does not apply. */
const EXCLUDED_DIRS = new Set([
  "test", "tests", "__tests__", "testdata", "fixtures", "__fixtures__", "golden", "corpus", "snapshots", "__snapshots__",
  "example", "examples", "sample", "samples", "demo", "demos",
  "generated",
  "vendor", "third_party", "third-party", "thirdparty", "node_modules", "bower_components", "external", "extern", "deps", "godeps", "pods", "carthage", "site-packages", "contrib",
]);

/** Bytes shared by the subdirectory REVIEW.md files a PR's paths reach, the root's not counted. */
export const SUBDIR_BUDGET = 150_000;

/** Bytes for the root REVIEW.md and everything it includes together. */
const INCLUDE_BUDGET = 150_000;

const MAX_INCLUDED_FILES = 8;

const MAX_SKILL_LINES = 8;

const SKILL_MAX = 30_000;

const MAX_LINKS = 64;

const SKILL_PATH = /^\.(?:claude|agents)\/skills\/[^/]+\/SKILL\.md$/;

const REGULAR = new Set(["100644", "100755"]);

/** Whether a subdirectory REVIEW.md applies: not in or below a test, example, generated or third-party directory. */
export function subdirApplies(file: string): boolean {
  return !file.split("/").slice(0, -1).some((dir) => EXCLUDED_DIRS.has(dir.toLowerCase()));
}

/** A line's container: how many blockquotes it sits in, and its content once their markers are taken off. */
function unquote(line: string) {
  let depth = 0;
  let rest = line;

  for (let m = /^ {0,3}>[ \t]?/.exec(rest); m; m = /^ {0,3}>[ \t]?/.exec(rest)) {
    depth++;
    rest = rest.slice(m[0].length);
  }

  return { depth, rest };
}

const LIST_MARKER = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?: {1,4}|\t|$)/;

/**
 * Which lines are literal, not Markdown prose: inside a fenced or indented code block, an HTML comment, or a pre, script,
 * style or textarea block, as CommonMark reads them. A fence closes on a bare run of its own character at least as long
 * as the one that opened it, so `~~~still-in-code` stays inside, or when the blockquote or list item it opened in ends.
 * A fence opened after a list marker (`- ~~~`) belongs to that item.
 */
export function literalLines(text: string): boolean[] {
  let fence: { char: string; length: number; depth: number; indent: number } | null = null;
  let closer: string | null = null;
  let afterBlank = true;
  let inIndented = false;
  let depth = 0;
  // The column a list item's content starts at, inside the current blockquotes; 0 outside a list.
  let listIndent = 0;

  return text.split("\n").map((raw) => {
    const quoted = unquote(raw);
    const blank = !quoted.rest.trim();

    // A line in fewer quotes ends the deeper ones, and any list or fence inside them.
    if (quoted.depth !== depth && !(blank && quoted.depth > 0)) {
      if (fence && quoted.depth < fence.depth) fence = null;

      listIndent = 0;
      depth = quoted.depth;
    }

    let line = quoted.rest;
    const indent = /^ */.exec(line)![0].length;

    // A non-blank line indented less than the item's content leaves the item, and closes a fence opened in it.
    if (!blank && listIndent && indent < listIndent) {
      if (fence && fence.indent >= listIndent) fence = null;

      listIndent = 0;
    }

    if (listIndent) line = line.slice(Math.min(indent, listIndent));

    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);

      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = null;

      return true;
    }

    if (closer) {
      if (line.toLowerCase().includes(closer)) closer = null;

      return true;
    }

    if (blank) {
      afterBlank = true;

      return inIndented;
    }

    // Indented code starts after a blank line (it cannot interrupt a paragraph) and runs until a line that is not indented.
    inIndented = /^(?: {4}|\t)/.test(line) && (afterBlank || inIndented);
    afterBlank = false;

    if (inIndented) return true;

    const marker = LIST_MARKER.exec(line);

    // A list item: its content starts after the marker, and is read as a line of its own.
    if (marker) {
      listIndent += marker[0].length;
      line = line.slice(marker[0].length);
    }

    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);

    // A backtick fence's info string holds no backtick; otherwise the run is inline code.
    if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      fence = { char: open[1]![0]!, length: open[1]!.length, depth, indent: listIndent };

      return true;
    }

    const block = /<!--|<(pre|script|style|textarea)(?=[\s>]|$)/i.exec(line);

    if (!block) return false;

    const end = block[1] ? `</${block[1].toLowerCase()}>` : "-->";

    // Closed on the same line, it is inline HTML in a prose line; the link counter strips it.
    if (line.toLowerCase().slice(block.index + block[0].length).includes(end)) return false;

    closer = end;

    return true;
  });
}

/**
 * Markdown links that count toward the limit: in prose (`literalLines`), outside inline code and comments, and not to
 * http, https or mailto addresses, nor to `#` anchors.
 */
export function countedLinks(text: string): number {
  const literal = literalLines(text);

  const prose = text
    .split("\n")
    .filter((_, i) => !literal[i])
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(pre|script|style|textarea)(?=[\s>])[\s\S]*?<\/\1>/gi, "")
    .replace(/(`+)[\s\S]*?\1/g, "");

  return [...prose.matchAll(/\]\(\s*([^)\s]*)/g)].filter(([, target]) => !/^(?:https?:|mailto:|#)/i.test(target!)).length;
}

/** A skill's body as a review gets it: no frontmatter, and a line that would inject a command's output says it did not run. */
export function skillBody(text: string): string {
  return text
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .split("\n")
    .map((line) => (line.includes("!`") ? "[a command here is not run in review]" : line))
    .join("\n")
    .trim();
}

/** A blob at `ref`: its text and tree mode, or null when the path names nothing. */
export type Blob = { text: string; mode: string } | null;

export type Expanded = { text: string; includes: string[]; skipped: string[] };

/** Why the whole root REVIEW.md is skipped, as Code Review skips it. */
export type Dropped = { dropped: string };

/**
 * The root REVIEW.md with each `@` line it includes replaced by the file's text, marked with its path. A line holding
 * only `@name` includes that file beside REVIEW.md; `@.claude/skills/<folder>/SKILL.md` or
 * `@.agents/skills/<folder>/SKILL.md` includes a skill's body. A line in a code fence, an HTML comment or a pre,
 * script, style or textarea block stays as text, and so does one naming no file beside REVIEW.md. Dropped when the
 * file alone reaches the byte limit or the links reach past theirs: then the whole root file is skipped.
 */
export function expandIncludes(text: string, read: (file: string) => Blob): Expanded | Dropped {
  if (Buffer.byteLength(text) >= INCLUDE_BUDGET) return { dropped: `REVIEW.md: ${Buffer.byteLength(text)} bytes on its own, past the ${INCLUDE_BUDGET} it and its includes share, so none of it applies` };

  const skipped: string[] = [];
  const includes: string[] = [];
  let bytes = Buffer.byteLength(text);
  let links = countedLinks(text);
  let skillLines = 0;
  const literal = literalLines(text);

  const lines = text.split("\n").map((line, i) => {
    // An `@` line in a code block or an HTML block is an example, not an include.
    if (literal[i]) return line;

    const trimmed = line.trim();
    const at = /^@(\S+)$/.exec(trimmed);

    if (!at) return line;

    const target = at[1]!;
    const skill = SKILL_PATH.test(target);

    if (!skill && target.includes("/")) return line;

    if (skill && ++skillLines > MAX_SKILL_LINES) return skip(line, `${target}: past ${MAX_SKILL_LINES} skill lines`);

    const blob = read(target);

    if (!blob) return skill ? skip(line, `${target}: no such skill`) : line;

    if (!REGULAR.has(blob.mode)) return skip(line, `${target}: not a regular file`);

    if (skill && Buffer.byteLength(blob.text) > SKILL_MAX) return skip(line, `${target}: over ${SKILL_MAX} bytes`);

    if (!includes.includes(target) && includes.length >= MAX_INCLUDED_FILES) return skip(line, `${target}: past ${MAX_INCLUDED_FILES} included files`);

    const content = skill ? skillBody(blob.text) : blob.text;

    // Limits apply to the content alone; the label around it only names the source for a breach to cite.
    if (bytes + Buffer.byteLength(content) >= INCLUDE_BUDGET) return skip(line, `${target}: REVIEW.md and its includes would reach ${INCLUDE_BUDGET} bytes`);

    bytes += Buffer.byteLength(content);

    if (!skill) links += countedLinks(content);

    if (!includes.includes(target)) includes.push(target);

    return skill ? `<!-- included skill ${target}: its text never skips a path, caps findings or lowers a severity -->\n${content}\n<!-- end of ${target} -->` : `<!-- included file ${target} -->\n${content}\n<!-- end of ${target} -->`;
  });

  function skip(line: string, why: string): string {
    skipped.push(`REVIEW.md include ${why}`);

    return line;
  }

  return links > MAX_LINKS ? { dropped: `REVIEW.md: more than ${MAX_LINKS} Markdown links across it and its includes, so none of it applies` } : { text: lines.join("\n"), includes, skipped };
}
