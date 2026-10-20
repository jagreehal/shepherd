---
"@jagreehal/shepherd": minor
---

- Lenses for React, Next.js, Node APIs, Go, Rust, Java, .NET, Python and Nx monorepos, plus OWASP ASVS and OWASP LLM lenses. `shepherd stack` detects your stack and `shepherd init --stacks` adds its lenses.
- Policy files compose: packs and `extends` nest, and each lens takes `gate`, `only` and `disable`.
- `tiers` name models once, and the `reviewers`, `fixers` and `validators` groups pin a tier to each role. `shepherd ci-models` hands CI the team's ladder, and `SHEPHERD_API_KEY` reaches whichever provider the session model uses.
- `shepherd workflows --audit` installs a weekly security audit that runs OWASP Secure Agent Playbook plays.
- The `lens-import` skill turns a skill, style guide or rule set into a lens that stamp can also read.
