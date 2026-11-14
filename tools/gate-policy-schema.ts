// Writes .shepherd/gate.schema.json from PolicySchema. gate/src/config.test.ts fails when the two drift.
import { writeFileSync } from "node:fs";
import { policyJsonSchema } from "../gate/src/policy.ts";

writeFileSync("gate/.shepherd/gate.schema.json", `${JSON.stringify(policyJsonSchema(), null, 2)}\n`);
