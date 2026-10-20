---
name: java
description: Java and Spring rules for a code review. Flags code that leaks resources, breaks transactions, trusts input or falls over under load in ways the compiler and static analysers miss. Covers @Transactional pitfalls, N+1 queries and unbounded fetches, missing authorisation on endpoints, unvalidated request bodies, queries and commands built from input, unsafe deserialisation and XML parsing, resources not closed, swallowed exceptions, thread-unsafe shared state in singletons, blocking calls without timeouts, and entity or API contract changes. Use as a review lens or as a stamp rule pack.
---

# java

Spring hides a lot behind annotations, proxies and a thread pool. Review
whether this change gets the transaction, security and lifecycle behaviour it
assumes, keeps singleton beans free of request state, and bounds the work a
single request can cause.

## Review

- **transaction-boundary**: `@Transactional` sits on a public method called through the Spring proxy, with the propagation, read-only flag and rollback rules the code needs. Flag: `@Transactional` on a private method or a method called from the same class (self-invocation skips the proxy), a checked exception that should roll back but does not (`rollbackFor` missing), a remote call or message publish inside a long transaction, a read path writing in a `readOnly` transaction. Why: data is committed half-done, or not at all, with no error.
- **query-shape**: Repository calls fetch what the code uses, in a bounded number of queries. Flag: a lazy association accessed in a loop (N+1), `findAll()` on a table that grows, a list endpoint with no `Pageable` or limit, `FetchType.EAGER` added to an entity. Why: a page that ran 3 queries in test runs 3,000 in production.
- **endpoint-authz** [refuse]: Every new controller method is covered by the security configuration and checks the caller may act on the resource. Flag: a new path not matched by the `SecurityFilterChain` rules, `permitAll` widened, a method taking an id with no ownership or role check (`@PreAuthorize` or an explicit check), CSRF disabled for a cookie-authenticated app. Why: the endpoint is public or lets users act on each other's data.
- **validate-input**: Request bodies and parameters are validated at the controller (`@Valid` with constraints) and bound to DTOs, never to entities. Flag: a `@RequestBody` entity, a DTO with no `@Valid`, mass assignment of fields like `role` or `id`. Why: callers set fields the code never meant to expose.
- **injection** [refuse]: Queries take input through bind parameters, commands through `ProcessBuilder` argument lists, file paths through a containment check. Flag: string concatenation into JPQL, SQL, `@Query(nativeQuery=true)` or `JdbcTemplate`; `Runtime.exec` with a built string; SpEL or OGNL evaluated over input; `Paths.get(base, userInput)` without normalising and checking the prefix. Why: injection and path traversal.
- **unsafe-parsing** [refuse]: Untrusted data is never handed to Java serialisation, and XML parsers disable external entities. Flag: `ObjectInputStream.readObject` on network or user data, Jackson default typing (`enableDefaultTyping`, `@JsonTypeInfo(use = CLASS)`) on untrusted input, a `DocumentBuilderFactory` or `XMLInputFactory` without XXE protection. Why: remote code execution and file disclosure.
- **resource-close**: Streams, connections, readers, clients and executors are closed with try-with-resources or a lifecycle hook. Flag: a `Connection`, `InputStream` or `HttpClient` response not closed on every path, an `ExecutorService` created per request and never shut down. Why: pools and file handles exhaust under load.
- **exception-handling**: Exceptions are handled once, with their cause, and never swallowed. Flag: an empty `catch`, `catch (Exception e) { log.error(e.getMessage()); }` that drops the stack, `throw new RuntimeException("failed")` without the cause, catching `InterruptedException` without restoring the interrupt flag. Why: the failure leaves no trail, or a thread pool cannot shut down.
- **singleton-state**: Singleton beans (the Spring default) hold no request or user state in fields, and shared mutable state is thread-safe. Flag: a non-final field set per request in a `@Service` or `@Controller`, a `HashMap` or `SimpleDateFormat` shared across threads, a static mutable cache with no bound or eviction. Why: requests see each other's data under concurrency.
- **blocking-timeouts**: Outbound HTTP, database and messaging calls set connect and read timeouts, and blocking calls stay off reactive or event-loop threads. Flag: a `RestTemplate`, `WebClient`, `HttpClient` or JDBC pool with default (infinite) timeouts, `.block()` inside a WebFlux handler, `@Async` with the default unbounded executor. Why: one slow dependency exhausts the thread pool.
- **contract-change**: Changes to entity mappings, DTOs serialised to clients, and public interfaces are deliberate and paired with a migration. Flag: a renamed or removed entity field with no migration, a changed `@Column` or `@Table`, a JSON field renamed, an enum persisted as `ORDINAL` that gains a value in the middle. Why: existing data or clients break at deploy.

## Fix

- Prefer: constructor injection, DTOs with Bean Validation, Spring Data pagination and fetch joins or entity graphs, try-with-resources, and the repository's configured HTTP client beans.
- Never touch: the security configuration beyond the endpoint in the PR, build files (`pom.xml`, `build.gradle`), and generated sources.
- Escalate: `endpoint-authz` and `contract-change` breaks, changes to transaction propagation on shared services, and any database migration.
