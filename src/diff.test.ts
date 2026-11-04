import { describe, expect, test } from "bun:test";
import { GENERATED, numberDiff } from "./diff.ts";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,3 @@ export function f() {
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
diff --git a/bun.lock b/bun.lock
--- a/bun.lock
+++ b/bun.lock
@@ -1 +1 @@
-x
+y
\\ No newline at end of file
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
`;

describe("numberDiff", () => {
  const out = numberDiff(PATCH);
  const lines = out.split("\n");

  test("writes each side's number on the line", () => {
    expect(out).toContain("|   10 |   10 |   | const a = 1;");
    expect(out).toContain("|   11 |      | - | const b = 2;");
    expect(out).toContain("|      |   11 | + | const b = 3;");
    expect(out).toContain("|   12 |   12 |   | const c = 4;");
  });

  test("the contents point at each file's own lines", () => {
    for (const [name, header] of [["src/a.ts", "diff --git a/src/a.ts b/src/a.ts"], ["bun.lock", "diff --git a/bun.lock b/bun.lock"], ["gone.ts", "diff --git a/gone.ts b/gone.ts"]] as const) {
      const entry = new RegExp(`^- ${name} → lines (\\d+)-(\\d+)`).exec(lines.find((l) => l.startsWith(`- ${name} `))!)!;

      expect(lines[Number(entry[1]) - 1]).toBe(header);
    }
  });

  test("flags generated files without dropping them", () => {
    expect(lines.find((l) => l.startsWith("- bun.lock"))).toEndWith("· generated");
    expect(lines.find((l) => l.startsWith("- src/a.ts"))).not.toContain("generated");
    expect(out).toContain("|      |    1 | + | y");
  });

  test("a line that looks like a file header inside a hunk stays code", () => {
    const tricky = "diff --git a/a.md b/a.md\n--- a/a.md\n+++ b/a.md\n@@ -1,1 +1,2 @@\n a\n+++ not a header\n";

    expect(numberDiff(tricky)).toContain("|      |    2 | + | ++ not a header");
    expect(numberDiff(tricky)).toContain("- a.md → lines");
  });

  test("names a quoted path as it is", () => {
    expect(numberDiff('diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"\n--- "a/caf\\303\\251.ts"\n+++ "b/caf\\303\\251.ts"\n@@ -1 +1 @@\n-a\n+b\n')).toContain("- café.ts → lines");
  });
});

test("GENERATED leaves source under build and vendor alone", () => {
  for (const f of ["bun.lock", "a/pnpm-lock.yaml", "dist/x.js", "src/__snapshots__/a.snap", "logo.png", "api.gen.ts", "drizzle/meta/0.json"]) expect(GENERATED.test(f)).toBe(true);

  for (const f of ["src/build/a.ts", "vendor/crate/lib.rs", "src/a.ts", "README.md"]) expect(GENERATED.test(f)).toBe(false);
});
