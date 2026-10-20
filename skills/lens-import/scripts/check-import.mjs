// Structural checks for an import. Semantic fidelity and source inventory completeness need review.
// No dependencies: this file also runs after the skill is copied out of the Shepherd bundle.
import { readFileSync, readdirSync, realpathSync, lstatSync } from "node:fs";
import path from "node:path";

const nonempty = (v) => typeof v === "string" && v.trim().length > 0;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const inside = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);
const withoutCode = (text) => text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
const linkPath = (value) => value.replace(/^<|>$/g, "");
const label = (value) => value.toLowerCase().replace(/\s+/g, " ").trim();
const definitions = (text) => [...withoutCode(text).matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(<[^>]+>|[^\s]+)/gm)];
const links = (text, document = text) => {
  const content = withoutCode(text);
  const refs = new Map(definitions(document).map((m) => [label(m[1]), linkPath(m[2])]));
  const inline = [...content.matchAll(/\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)].map((m) => linkPath(m[1]));
  const named = [...content.matchAll(/\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)].flatMap((m) => {
    const target = refs.get(label(m[2] || m[1]));

    return target ? [target] : [];
  });

  return [...inline, ...named, ...definitions(content).map((m) => linkPath(m[2]))];
};
const external = (link) => /^(https?:|mailto:|#)/i.test(link);
const ruleLine = /^- \*\*([a-z0-9][a-z0-9-]*)\*\*(?: \[(refuse|escalate|note)\])?:\s+(.+)$/gm;

export function checkImport(reportFile) {
  const errors = [];
  const report = JSON.parse(readFileSync(reportFile, "utf8"));

  if (!object(report) || report.version !== 1 || !nonempty(report.root) || !Array.isArray(report.lenses) || !Array.isArray(report.rules) || !Array.isArray(report.sources)) {
    return ["report needs version: 1, root, sources, lenses and rules"];
  }

  const root = realpathSync(path.resolve(path.dirname(reportFile), report.root));
  const outputs = new Map();
  const declared = new Set();
  const resolveOutput = (rel) => {
    if (!nonempty(rel) || path.isAbsolute(rel)) throw new Error("output paths must be repository-relative");
    const file = path.resolve(root, rel);

    if (!inside(root, file) || !inside(root, realpathSync(file))) throw new Error(`output escapes target: ${rel}`);

    return file;
  };

  for (const lens of report.lenses) {
    try {
      const dir = resolveOutput(lens);

      if (declared.has(dir)) throw new Error(`duplicate lens: ${lens}`);
      declared.add(dir);
      const text = readFileSync(path.join(dir, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
      const section = /^## Review\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1];

      if (!section) throw new Error(`${lens}: missing Review section`);

      if (`## Review\n${section}`.length > 5500) errors.push(`${lens}: Review exceeds 5500 characters; split the lens`);
      const rules = [...withoutCode(section).matchAll(ruleLine)];

      if (!rules.length) errors.push(`${lens}: no review rules`);

      for (const [, id, severity, body] of rules) {
        const key = `${dir}#${id}`;

        if (outputs.has(key)) errors.push(`${lens}: duplicate rule ${id}`);
        outputs.set(key, 0);

        if (!severity) errors.push(`${lens}/${id}: set an explicit severity`);

        if (!links(body, text).some((link) => !external(link))) errors.push(`${lens}/${id}: link a bundled source excerpt`);
      }

      const walk = (folder) => {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
          const file = path.join(folder, entry.name);

          if (lstatSync(file).isSymbolicLink()) {
            errors.push(`${lens}: symlink is not a portable snapshot: ${path.relative(dir, file)}`);
          } else if (entry.isDirectory()) walk(file);
          else if (entry.name.endsWith(".md")) {
            for (const link of links(readFileSync(file, "utf8"))) {
              if (external(link)) continue;
              const rel = decodeURIComponent(link.split(/[?#]/)[0]);

              try {
                if (path.isAbsolute(rel) || /^[a-z][a-z0-9+.-]*:/i.test(rel)) throw new Error("not a relative snapshot path");
                const target = realpathSync(path.resolve(path.dirname(file), rel));

                if (!inside(dir, target)) throw new Error("outside this lens");
              } catch {
                errors.push(`${lens}: missing or nonportable link ${link} in ${path.relative(dir, file)}`);
              }
            }
          }
        }
      };

      walk(dir);
    } catch (e) {
      errors.push(e.message);
    }
  }

  const inventory = new Set();

  for (const item of report.rules) {
    if (!object(item) || !nonempty(item.id) || !nonempty(item.source) || !nonempty(item.reason) || !["kept", "dropped", "uncertain"].includes(item.disposition)) {
      errors.push("every inventory item needs id, source, disposition and reason");
      continue;
    }

    const source = `${item.source}#${item.id}`;

    if (inventory.has(source)) errors.push(`duplicate inventory item: ${source}`);
    inventory.add(source);

    if (item.disposition !== "kept") {
      if (item.output !== undefined) errors.push(`${source}: only kept items can map to output`);
      continue;
    }

    if (!object(item.examples) || !nonempty(item.examples.flags) || !nonempty(item.examples.quiet)) errors.push(`${source}: record a violating and valid example`);

    try {
      if (!object(item.output) || !nonempty(item.output.id)) throw new Error(`${source}: kept item needs output lens and id`);
      const key = `${resolveOutput(item.output.lens)}#${item.output.id}`;

      if (!outputs.has(key)) errors.push(`${source}: output rule not found: ${item.output.id}`);
      else outputs.set(key, outputs.get(key) + 1);
    } catch (e) {
      errors.push(e.message);
    }
  }

  for (const [rule, count] of outputs) if (count !== 1) errors.push(`${path.relative(root, rule)}: expected one inventory mapping, got ${count}`);

  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    if (process.argv.length !== 3) throw new Error("usage: node check-import.mjs <import-report.json>");
    const errors = checkImport(path.resolve(process.argv[2]));

    for (const error of errors) console.error(`problem: ${error}`);
    if (!errors.length) console.log("Import structure checked: rule accounting, examples, budgets and bundled links. Semantic review still required.");
    process.exitCode = errors.length ? 1 : 0;
  } catch (e) {
    console.error(`problem: ${e.message}`);
    process.exitCode = 1;
  }
}
