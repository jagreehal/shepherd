---
name: pair
description: >
  Pair-programming judgement gate. Run it before asking your pair a question and
  before saying a task is done. It decides whether to act without asking, act
  and state the alternative, or stop and ask, and it forces the refactor
  checkpoint of red/green/refactor. triage uses it on ambiguous review threads.
  Use whenever you are about to ask permission, about to say "done", or about
  to skip a simplification because nobody asked for it.
---

# Pair

Work like a teammate who owns the result. Make the calls the rules settle, improve
the code as part of the job, and interrupt your pair only when the answer is
genuinely theirs to give. "Your pair" is the human you are working with.

## Red, green, refactor, for design too

Take the smallest step that works. At green, ask:

> Am I done, or should I make this better?

Green is not done. Usually the honest answer is "one small thing better, then
done". The order holds: make it work, make it right, make it fast.

## The ladder

Place every improvement you spot, and every question you want to ask, on this
ladder.

### Just do it

The result is clearly better and there is one sensible way to get there. It is
small, reversible, and improves the four rules below. Examples: parameterising
duplicated tests, extracting a small testable unit from a sprawling method,
removing duplication, a clearer name, a tighter type on a line you already touch.

Asking here wastes your pair's time. Do it, and mention it if it is worth knowing.

### Do it, then say so

There is more than one reasonable answer. Pick the one you would defend, do it,
and state the fork in one line so your pair can redirect cheaply: "did X because
Y; the alternative was Z, say if you'd rather Z." Never present a menu with no
opinion.

### Stop and ask

Only in these cases, however confident you feel:

- the change would break one of the four rules of simple design, or
- it is genuinely unclear which outcome is better, or the requirement is
  ambiguous in a way that changes the design, or
- it changes behaviour users, callers, or data depend on and nothing in the task
  asked for that: what a function accepts, returns, throws, or writes for
  input that was valid before.

Asking too much everywhere else is the mistake.

## The four rules of simple design

1. Passes the tests.
2. Expresses every idea it needs to.
3. Says everything once and only once.
4. Has no superfluous parts.

They conflict; balance them for the next reader.

## What "better" means

- **Correct first.** A small tested module beats a large method, unless the
  split hides what actually happens.
- **Make bad states unrepresentable.** Types and structures over runtime checks
  and constants.
- **Coupling breeds complexity.** Avoiding coupling can outrank removing
  duplication. The wrong abstraction costs more than a little repetition.
- **Small deployable steps.** The smallest change that can ship on its own.
- **Know how you would tell it worked.** A log, a metric, an event. Going on
  instinct is allowed when it is a decision.
- **Flags by risk.** Risky or disruptive behaviour goes behind a flag. A change
  meant to move a metric wants an experiment. A refactor needs neither.

## Guardrails against dogma

- Do not deduplicate for its own sake.
- Do not rewrite untouched lines for consistency; improve what you touch.
- Do not extract what is already short and clear.
- Do not apply a rule that makes the code harder to read. The rules serve the reader.

## At each trigger

**Before a question:** answer it against the ladder first. "Just do it" means do
it. "Do it, then say so" means act and phrase the fork as a recommendation. Only
"stop and ask" earns a bare question.

**Before "done":** run the refactor beat. Check the four rules and "what better
means", take the one clearly better improvement, note what you are deliberately
leaving, and confirm the step can ship alone. Then say done plainly.

## As a triage gate

`triage` hands you one ambiguous review thread and its proposed change. Return
exactly one of:

```
LADDER: just-do-it | <the change, one line>
LADDER: do-and-say | <the change> | alternative: <the other option> | why: <one line>
LADDER: stop-and-ask | <which rule it breaks, or what is unclear>
```
