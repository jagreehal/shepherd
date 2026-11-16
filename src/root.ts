import path from "node:path";

/** The package root. This file sits one level down in source and the bundle sits one level down in dist, so both resolve it. */
export const PACKAGE_ROOT = path.resolve(import.meta.dir, "..");
