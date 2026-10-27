import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BRANDING } from "./config.ts";
import { renderReview, renderSummary } from "./summary.ts";

// Real rounds that models handed off in CI, kept with the files they reviewed (fixtures/rounds/README.md). Each one is
// rendered as the publish job renders it and held to what a reader relies on.
const ROOT = path.resolve(import.meta.dir, "../fixtures/rounds");

const cases = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => {
    const dir = path.join(ROOT, d.name);

    return readdirSync(path.join(dir, "rounds")).map((round) => ({ name: `${d.name}/${round}`, files: path.join(dir, "files"), round: path.join(dir, "rounds", round) }));
  });

const indent = (line: string) => /^[ \t]*/.exec(line)![0];

describe("replayed CI rounds", () => {
  test("the fixtures hold rounds to replay", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    test(c.name, () => {
      const read = (p: string) => (existsSync(path.join(c.files, p)) ? readFileSync(path.join(c.files, p), "utf8") : null);
      const round = JSON.parse(readFileSync(path.join(c.round, "round.json"), "utf8"));
      const fanoutFile = path.join(c.round, "fanout.json");
      const fanout = existsSync(fanoutFile) ? JSON.parse(readFileSync(fanoutFile, "utf8")) : undefined;

      // It renders.
      const md = renderSummary(round, BRANDING.emoji, null, undefined, fanout, undefined, read);
      const review = renderReview(round, BRANDING.emoji, "header", read);
      const places = review.comments.map((comment) => `${comment.path}:${comment.start_line ? `${comment.start_line}-` : ""}${comment.line}`);

      // One comment per place.
      expect(new Set(places).size).toBe(places.length);

      for (const [i, comment] of review.comments.entries()) {
        const lines = (read(comment.path) ?? "").split("\n");

        // Every comment lands inside its file, and the summary cites the same place.
        expect(comment.line).toBeLessThanOrEqual(lines.length);
        expect(md).toContain(`\`${places[i]}\``);

        // A suggestion is committed as written, so it carries the indentation of the line it replaces.
        const suggestion = /```suggestion\n([\s\S]*?)\n```/.exec(comment.body)?.[1];

        if (suggestion !== undefined) expect(indent(suggestion)).toBe(indent(lines[(comment.start_line ?? comment.line) - 1] ?? ""));
      }
    });
  }
});
