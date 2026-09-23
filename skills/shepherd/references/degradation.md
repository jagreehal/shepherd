# Degradation

**Always say which degradation you took**, in the narration and the summary. A
run missing two of its runners looks identical to a clean one otherwise.

- **triage missing:** skip it; run ci-repair and stamp. Report thread counts as unknown.
- **ci-repair missing:** skip the base update and CI repair; stamp runs against
  `H1`. Report CI as unknown.
- **swarm missing:** skip review in every round. Triage still handles existing
  bot threads, and simplify still runs.
- **review-simplicity missing:** skip Step 2c every round.
- **A lens missing:** swarm's router covers the concern; see swarm's degradation.
- **Agents cannot be started:** run triage and ci-repair inline from their
  skill bodies. They then cost session-model rates, so on a budget prefer
  skipping a runner to running it inline.
- **No cheaper model:** see `models.md`; cut the round cap to 2.
- **stamp absent:** report `stamp=absent`; the terminal condition drops its
  approval clause.
- **Commits blocked** (a signing harness with no tool offered): run review and
  triage in report-only mode, push nothing, and say so.
- **User interrupts:** stop at the next checkpoint and print the summary.
