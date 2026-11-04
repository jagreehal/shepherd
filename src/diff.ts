// What a reviewer reads: a diff with its line numbers written out and a contents list.
import { unquotePath } from "./local.ts";

/**
 * Files whose hunks carry nothing a reviewer weighs: lockfiles, minified and generated output, snapshots, images and
 * fonts, built trees, migration metadata. `build/` and `vendor/` stay out: source lives under both.
 */
export const GENERATED =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|.*\.snap|.*\.min\.(js|css)|.*\.map|.*\.lock|.*\.(pb\.go|_pb2\.py|g\.dart)|.*\.(generated|gen)\.[^/]+|.*\.(svg|png|jpe?g|gif|ico|webp|woff2?|ttf|pdf))$|(^|\/)(dist|generated|__generated__|node_modules|\.yarn|__snapshots__|coverage|\.next|\.turbo|drizzle\/meta)\//i;

const pad = (n: number) => String(n).padStart(4, " ");

/**
 * A unified diff with each hunk line's old and new numbers beside it, `| OLD | NEW | TYPE | code`, under a contents
 * list giving each file's lines in this output, so a reviewer cites a line without counting from a hunk header.
 * Generated files are flagged in the contents and kept in the body. `coverage` and `inline` read the raw diff.
 */
export function numberDiff(patch: string): string {
  const files: { name: string; lines: string[] }[] = [];
  let file: (typeof files)[number] | undefined;
  let [oldAt, newAt, oldLeft, newLeft] = [0, 0, 0, 0];

  for (const l of patch.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (l.startsWith("\\")) file?.lines.push(l);
      else if (l.startsWith("+")) {
        file?.lines.push(`|      | ${pad(newAt++)} | + | ${l.slice(1)}`);
        newLeft--;
      } else if (l.startsWith("-")) {
        file?.lines.push(`| ${pad(oldAt++)} |      | - | ${l.slice(1)}`);
        oldLeft--;
      } else {
        file?.lines.push(`| ${pad(oldAt++)} | ${pad(newAt++)} |   | ${l.slice(1)}`);
        oldLeft--;
        newLeft--;
      }

      continue;
    }

    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);

    if (l.startsWith("diff --git ")) {
      file = { name: / b\/(.+)$/.exec(l)?.[1] ?? l.slice(11), lines: [] };
      files.push(file);
    } else if (hunk) {
      [oldAt, oldLeft, newAt, newLeft] = [Number(hunk[1]), Number(hunk[2] ?? 1), Number(hunk[3]), Number(hunk[4] ?? 1)];
    } else if (file && (l.startsWith("+++ ") || l.startsWith("--- "))) {
      // `+++` names the file as it is now; a deleted file's only name is on `---`.
      const v = unquotePath(l.slice(4).replace(/\t$/, ""));

      if (v !== "/dev/null") file.name = v.replace(/^[ab]\//, "");
    }

    if (l || file?.lines.length) file?.lines.push(l);
  }

  // The contents take one line per file plus a heading, a blank line, `---` and a blank line.
  let at = files.length + 5;

  const contents = files.map((f) => {
    const start = at;

    at += f.lines.length;

    return `- ${f.name} → lines ${start}-${at - 1}${GENERATED.test(f.name) ? " · generated" : ""}`;
  });

  return [`## Files (${files.length})`, ...contents, "", "---", "", ...files.flatMap((f) => f.lines)].join("\n");
}
