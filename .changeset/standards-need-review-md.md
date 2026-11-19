---
"@jagreehal/shepherd": patch
---

Each standards entry names its rule's `source` beside the `finding`. A breach posts as a line comment when its finding opens with the changed file's `file:line` and its source is a `REVIEW.md` in a directory above that file, or a file or skill the root `REVIEW.md` includes. Other breaches, such as `CODING_STANDARDS.md` ones, go in notes. Shepherd labels each included file with its path, and the labels count toward no limit. The `shepherd gate --json` evidence file holds each standards entry as `{ source, finding }`.
