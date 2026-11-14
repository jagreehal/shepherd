#!/usr/bin/env bun
// `shepherd gate …` is the approval gate (formerly gate); everything else is the shepherd CLI.
if (process.argv[2] === "gate") {
  process.argv.splice(2, 1);
  await import("../gate/src/cli.ts");
} else {
  await import("./cli.ts");
}

export {};
