---
name: node-api
description: Node.js HTTP service rules for a code review (Express, Fastify, Hono, Koa, NestJS). Flags handlers that skip auth, trust input, leak errors, hang or lose work. Covers middleware mount order, per-resource authorisation, unvalidated bodies and params, queries and commands built from input, error responses that leak internals, async errors that escape the handler, missing timeouts on outbound calls, unbounded bodies and lists, idempotency on retried writes, blocking the event loop, untyped request augmentation and unsafe CORS. Use as a review lens or as a stamp rule pack.
---

# node-api

An HTTP handler is a public function anyone on the network can call with any
input, at any rate. Review whether this change checks who is calling, rejects
input it cannot handle, answers without leaking how it works, and never leaves
the process hung or the data half-written.

## Review

- **mount-order** [refuse]: Auth, rate-limit and body-size middleware are registered before the routes they protect. Flag: a new router mounted above `app.use(auth)`, a route registered in a plugin that Fastify encapsulates outside the auth hook, an error handler mounted before the routes. Why: Express and friends run middleware in registration order, so the route is public.
- **resource-authz** [refuse]: A handler that reads or changes a resource by id checks the caller may act on that resource, not only that they are signed in. Flag: `findById(req.params.id)` returned or updated with no owner, tenant or role check; an admin action guarded only by authentication. Why: any signed-in user can read or change anyone's data (IDOR).
- **validate-input**: Body, params, query and headers are parsed with a schema at the boundary, and the handler uses the parsed value. Flag: `req.body` spread into a database write, `Number(req.query.limit)` with no bounds, a schema parsed but the raw body used afterwards, mass assignment of fields like `role` or `isAdmin`. Why: callers send shapes the code never expected.
- **injection** [refuse]: Queries, shell commands, file paths and URLs take input only through parameters, argument arrays and validated values. Flag: SQL or NoSQL query strings built with template literals, `exec` with interpolated input, `path.join(base, req.params.file)` with no containment check, a server-side fetch to a URL from the request. Why: injection, path traversal and SSRF.
- **error-leak**: Error responses carry a stable code and message, never stack traces, SQL, internal hostnames or the raw error object. Flag: `res.status(500).json(err)`, `res.send(err.message)` for unexpected errors, a framework's dev error page enabled by default. Why: attackers map the system from it, and clients come to depend on internal text.
- **async-error-path**: Every async handler's rejection reaches the framework's error handler. Flag: an `async` Express 4 handler with no wrapper or `next(err)`, a promise started in a handler and not awaited, `.catch(() => {})` that answers 200. Why: an unhandled rejection hangs the request or crashes the process.
- **outbound-timeout**: Calls to databases, HTTP services and queues set a timeout and handle its failure. Flag: `fetch` with no `signal`/`AbortSignal.timeout`, an HTTP client with no timeout, a database pool with no acquire or statement timeout, a retry loop with no limit or backoff. Why: one slow dependency holds every request open until the service falls over.
- **bounded-work**: Request bodies, uploads, list endpoints and batch inputs have limits. Flag: a JSON or raw body parser with no size limit, a list endpoint with no pagination or max page size, a batch endpoint that loops over unbounded input, a regex from or over user input that can backtrack. Why: one request can exhaust memory or CPU for everyone.
- **idempotent-writes**: A write the client or a queue can retry (payments, orders, emails, webhooks) is safe to repeat: an idempotency key, a unique constraint, or a check-and-insert in one transaction. Flag: a webhook handler that does work before checking it has seen the event, a POST that creates a duplicate on retry. Why: retries are normal, so duplicates reach production.
- **event-loop-block**: Request handlers do no synchronous heavy work. Flag: `fs.readFileSync`, `execSync`, `crypto.pbkdf2Sync`, large `JSON.parse` or sorting of unbounded data inside a handler. Why: every concurrent request waits behind it.
- **typed-request-context**: Data attached to the request (`req.user`, tenant, request id) is declared through the framework's typing (module augmentation, Fastify decorators, Hono variables) and read from that one place. Flag: `(req as any).user`, a second ad-hoc property for the same thing, reading a user from a header after auth already set it. Why: a renamed field type-checks and the auth check quietly reads `undefined`.
- **cors-credentials**: CORS allows only known origins when credentials are allowed. Flag: `origin: true` or reflecting `req.headers.origin` with `credentials: true`, `*` added to an authenticated API. Why: any site can make authenticated calls as the visitor.

## Fix

- Prefer: the repository's existing validation schemas, auth middleware, error handler and HTTP client wrapper; parameterised queries through its database layer; `AbortSignal.timeout`.
- Never touch: the server entry file's middleware order beyond the route in the PR, global error handling, CORS and rate-limit configuration.
- Escalate: `mount-order`, `resource-authz` and `cors-credentials` breaks, since they change who can call the service; changing a response's error shape that clients read; adding a new dependency.
