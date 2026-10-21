---
"@jagreehal/shepherd": minor
---

- Install Shepherd as a Claude Code plugin with `/plugin install shepherd --marketplace jagreehal/shepherd`, or as a Cursor plugin from `.cursor-plugin/`.
- Name any installed plugin's skill as a lens with `<plugin>:<skill>`. Lenses also resolve from Cursor's skills directories.
- The `pstack` lens and pack turn pstack's engineering principles into review rules. `shepherd init` suggests the lens when pstack is installed, and `shepherd doctor` lists skill names that other plugins share with Shepherd.
- The loop loads its sub-skills by path, so it runs Shepherd's own `swarm`, `triage` and `ci-repair`.
- Swarm matches a base-merge head by `git patch-id`. ci-repair and triage test the premise behind two earlier fixes before a third, and triage reuses a bot's checked dismissals from the bot's third pass.
- CI model jobs receive only the provider keys their models use.
