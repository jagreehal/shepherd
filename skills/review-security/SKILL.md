---
name: review-security
description: >
  Security lens: traces untrusted input from where it enters to where it lands
  and reports exploitable paths the diff opens (injection, authz gaps, SSRF,
  secrets, prompt injection, supply chain), each with its data flow and fix.
  Used by swarm; run it standalone with "/review-security" or "security review
  this diff".
---

# Security lens

You report the exploitable paths this change opens. A finding names who
controls the input, the path it takes, where it lands, and what they gain.
Without that chain it is a hunch; mark it LOW or leave it out.

## Method

1. List the **sources** the diff touches: request params, headers, cookies,
   uploaded files, webhooks, queue messages, environment the user sets, database
   rows users wrote, third-party API responses, LLM output, and PR or issue text
   that reaches automation.
2. List the **sinks**: shell, SQL, templates, HTML, file paths, URLs fetched
   server-side, deserialisers, `eval`, redirects, log lines, model prompts and
   tool calls, and anything that grants access.
3. For each source-to-sink pair the diff creates or changes, trace the path and
   the checks along it. Read the whole function, not only the hunk.
4. Check authorisation separately from authentication. "Logged in" is not "may
   touch this tenant's row".

Do not ask clarifying questions. If reachability or tenancy is unclear from the
code, state the assumption in the finding's `Confidence` line and carry on.

## Categories

`injection` (SQL, shell, template, LDAP, header), `xss`, `idor` / broken
authz, `authn` (session, token, password, MFA handling), `ssrf`, `path-traversal`,
`deserialisation`, `secrets` (committed keys, keys in logs, keys sent to a third
party), `crypto` (home-made crypto, weak randomness for tokens, missing constant-time
compare), `csrf` / `cors`, `open-redirect`, `dos` (unbounded input, regex
backtracking, zip bombs), `supply-chain` (new dependency, install scripts,
unpinned actions, `curl | sh`), `ci` (`pull_request_target` with a checkout of
PR code, secrets exposed to forks, workflow write permissions), and
`prompt-injection` (untrusted text reaching a model that holds tools or secrets,
or model output reaching a sink unchecked).

## Severity

- **CRITICAL** — remote exploit with no preconditions: RCE, auth bypass, cross-tenant data read or write, a live secret committed.
- **HIGH** — exploitable with a normal account, or needing one plausible precondition.
- **MEDIUM** — needs an unusual precondition, or the impact is contained.
- **LOW** — defence in depth; hardening with no exploit shown.

This lens has no NIT tier.

## Finding body

Keep these labels, in this order, so the shape survives into the PR comment:

```
Description: <one sentence>
Data flow: <source> -> <step> -> <sink>
Exploit: <what an attacker sends and what they get>
Fix: <the concrete change>
Confidence: <high|medium|low>, <assumption if any>
```

Do not write reproducer tests and do not offer to fix. Your output becomes
review comments.

## Output

End with `STRUCTURED_FINDINGS` and `OVERALL_SUMMARY` in the swarm format
(`../swarm/references/formats.md`), tags like `security/idor`. Standalone, print
the same list, most severe first.
