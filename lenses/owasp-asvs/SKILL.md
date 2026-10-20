---
name: owasp-asvs
description: >
  OWASP ASVS 5.0 rules for a code review, in any language or framework. Flags
  changes that break an ASVS requirement a diff can show: injection, output
  encoding, SSRF, unsafe parsing, server-side validation and mass assignment,
  business-flow atomicity, rate limits, file uploads and paths, cookies,
  sessions, token validation, authorization at function, object and field level,
  password storage, account enumeration, cryptography, secrets and transport,
  data exposure, error leakage and fail-open handling, and security event
  logging. Each finding cites the ASVS requirement and CWE. Use as a review lens
  or as a stamp rule pack.
source: github:OWASP/secure-agent-playbook/plugins/code-security-skills/skills/security-guidance@65d4efd2cd0b081d52101e9708792b944e4ddebb
license: CC-BY-4.0
---

# owasp-asvs

Review the change against the OWASP Application Security Verification Standard
5.0, whatever the stack. Each rule names the requirements it checks, so a
finding reads as a traceable ASVS gap. Cite the requirement id with the rule id.
The full requirement text lives in the source under `data/asvs/V<chapter>.md`.

## Review

- **injection** [refuse]: Untrusted data reaches a query, shell, LDAP, XPath, template or evaluator only as a bound parameter. Flag: a query or command built by concatenation, eval or SpEL on input, a template compiled from input. Why: injection. (ASVS 1.2.4, 1.2.5, 1.3.2, 1.3.7, CWE-74)
- **output-encoding**: Output is encoded for its context (HTML, attribute, JS or JSON, URL, header), and a URL from input allows only http(s). Flag: input concatenated into markup or script, a `javascript:` link. Why: XSS. (ASVS 1.2.1-1.2.3, CWE-79)
- **ssrf** [refuse]: A server-side request to a URL or host from input checks scheme, host and port against an allowlist and follows no redirect. Flag: fetching a user-supplied URL. Why: internal services and cloud metadata exposed. (ASVS 1.3.6, 15.3.2, CWE-918)
- **unsafe-parsing** [refuse]: XML parsers disable external entities, and untrusted data deserializes into allowlisted types or plain data. Flag: default XML parser settings, native object deserialization of request data. Why: XXE and code execution. (ASVS 1.5.1, 1.5.2, CWE-611, CWE-502)
- **server-validation**: The server validates input against allowlists and ranges and binds only permitted fields. Flag: a check enforced only in the client, a request body bound whole to a model. Why: tampering and mass assignment. (ASVS 2.2.1, 2.2.2, 15.3.3, CWE-20, CWE-915)
- **atomic-flow**: Multi-step flows enforce their order, a business operation commits or rolls back whole, and a check and the action it guards run atomically. Flag: a skippable step, writes outside a transaction, check-then-act on stock or balance. Why: double spends. (ASVS 2.3.1, 2.3.3, 2.3.4, 15.4.2, CWE-367)
- **rate-limit**: Login, reset, signup, messaging and costly endpoints carry anti-automation limits. Flag: a new such endpoint with no limit. Why: brute force and quota drain. (ASVS 2.4.1, 6.3.1, CWE-307, CWE-770)
- **file-handling** [refuse]: Uploads cap size, check extension and content, and paths come from internal ids or stay under a fixed root; archives cap size and entry count and ignore entry paths. Flag: a user filename in a path. Why: traversal and zip slip. (ASVS 5.2.1-5.2.3, 5.3.2, 5.3.3, CWE-22, CWE-434)
- **cookie-flags**: Session cookies set Secure, HttpOnly and SameSite, with a `__Host-` prefix when not shared. Flag: a session cookie missing a flag. Why: theft and CSRF. (ASVS 3.3.1, 3.3.2, 3.3.4, CWE-614)
- **session-lifecycle**: Login issues a new session token from a CSPRNG, and logout or account disable invalidates it on the server. Flag: a reused session id, a logout that only clears the cookie. Why: fixation and replay. (ASVS 7.2.3, 7.2.4, 7.4.1, 7.4.2, CWE-384, CWE-613)
- **token-validation** [refuse]: Self-contained tokens verify their signature with an allowlisted algorithm and a preconfigured key, then `exp`, `nbf`, audience and type. Flag: decode without verify, `alg: none`, a key URL from the token. Why: forged identity. (ASVS 9.1.1-9.1.3, 9.2.1-9.2.3, CWE-347)
- **access-control** [refuse]: The server checks the caller's permission for each function, object and field it reads or writes. Flag: a new route or query with no check, a lookup by id without an owner filter. Why: IDOR and privilege escalation. (ASVS 8.2.1-8.2.3, 8.3.1, CWE-639, CWE-862)
- **password-storage** [refuse]: Passwords hash with argon2id, scrypt, bcrypt or PBKDF2 and verify exactly as typed, with 64+ characters allowed. Flag: a fast hash, truncation or lower-casing. Why: offline cracking. (ASVS 11.4.2, 6.2.8, 6.2.9, CWE-916)
- **account-enumeration**: Login, signup and reset answer the same for known and unknown accounts. Flag: "user not found", a different status code or timing. Why: account discovery. (ASVS 6.3.8, CWE-204)
- **approved-crypto**: Encryption uses authenticated modes with unique nonces, hashing avoids MD5 and SHA-1, secrets and ids come from a CSPRNG. Flag: ECB, a fixed IV, `Math.random` for a token. Why: broken confidentiality. (ASVS 11.3.1-11.3.4, 11.4.1, 11.5.1, CWE-327, CWE-338)
- **secret-transport**: Secrets come from a secret store, never code or URLs, and outbound calls use verified TLS. Flag: a key literal, a token in a query string, verification off. Why: leaks. (ASVS 13.3.1, 14.2.1, 12.2.1, CWE-798, CWE-319)
- **data-minimisation**: Responses return only needed fields, and sensitive data skips trackers and shared caches. Flag: a whole record serialized to the client. Why: exposure. (ASVS 15.3.1, 14.2.2, 14.2.3, CWE-200)
- **fail-closed**: Clients get generic errors, and an exception in validation or authorization denies. Flag: a stack trace or query in a response, a catch that proceeds. Why: leakage and fail-open. (ASVS 16.5.1, 16.5.3, 13.4.2, CWE-209, CWE-636)
- **security-events**: Authentication outcomes and authorization failures are logged with who and what, without secrets. Flag: a new auth path with no log. Why: attacks go unseen. (ASVS 16.3.1-16.3.3, CWE-778)

## Fix

- Prefer: the framework's parameterized queries, encoders, session, token and password-hashing APIs, and the repository's existing authorization helper.
- Never touch: cryptographic keys, secret stores, identity provider configuration.
- Escalate: `access-control`, `token-validation`, `password-storage`, `session-lifecycle` and `approved-crypto` changes that alter an existing contract, and any new dependency.
