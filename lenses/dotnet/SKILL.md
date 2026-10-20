---
name: dotnet
description: C# and ASP.NET Core rules for a code review. Flags code that deadlocks, leaks, trusts input or loses data in ways the compiler and Roslyn analysers miss. Covers sync-over-async and async void, cancellation tokens not passed, missing authorization on endpoints, unvalidated input and over-posting, raw SQL and commands built from input, unsafe deserialisation, EF Core N+1 and tracking pitfalls, DI lifetime mismatches, HttpClient misuse, disposables not disposed, swallowed exceptions, and API and entity contract changes. Use as a review lens or as a stamp rule pack.
---

# dotnet

ASP.NET Core runs every request on a shared thread pool with services wired
by lifetime. Review whether this change stays async end to end, carries
cancellation, gives each service a lifetime that matches its dependencies, and
checks who is calling before it touches data.

## Review

- **sync-over-async**: Async code is awaited all the way up. Flag: `.Result`, `.Wait()` or `.GetAwaiter().GetResult()` on a task in request code, `async void` outside event handlers, a fire-and-forget `Task` with no error handling, `Task.Run` wrapping I/O in a request. Why: thread-pool starvation and deadlocks under load, and exceptions that crash the process.
- **cancellation**: Endpoints and async methods accept a `CancellationToken` and pass it to I/O (EF Core, `HttpClient`, streams). Flag: a new async method that does I/O with no token, a token accepted and not passed on, `CancellationToken.None` in a request path. Why: abandoned requests keep querying and holding connections.
- **endpoint-authz** [refuse]: Every new controller action or minimal API endpoint is covered by authorization and checks the caller may act on the resource. Flag: `[AllowAnonymous]` added, a new endpoint group without `RequireAuthorization` where the app has no fallback policy, a handler loading a record by id with no ownership or policy check. Why: the endpoint is public or exposes other users' data.
- **validate-input**: Request models are validated (data annotations, FluentValidation, or explicit checks) and bound to DTOs, never to EF entities. Flag: an entity used as a request body, missing `ModelState`/validation in a non-`[ApiController]` controller, an over-posted field like `IsAdmin` or `TenantId`. Why: callers set fields the code never meant to expose.
- **injection** [refuse]: SQL takes input through parameters, commands through `ProcessStartInfo.ArgumentList`, file paths through a containment check. Flag: `FromSqlRaw` or `ExecuteSqlRaw` with interpolated input (use `FromSql`/`FromSqlInterpolated`), string-built `SqlCommand` text, `Path.Combine(root, userInput)` without checking the full path stays under root. Why: injection and path traversal.
- **unsafe-deserialization** [refuse]: Untrusted data never reaches `BinaryFormatter`, `NetDataContractSerializer`, or polymorphic type handling that names types from the payload. Flag: `TypeNameHandling` other than `None` in Newtonsoft settings for untrusted input, `BinaryFormatter` anywhere, `XmlDocument` with a resolver on untrusted XML. Why: remote code execution.
- **ef-query-shape**: EF Core queries fetch what the code uses, in a bounded number of round trips. Flag: navigation properties read in a loop (N+1 through lazy loading), `ToList()` before `Where`, a list endpoint with no paging, tracked queries on read-only paths that load many rows, `Include` chains that explode rows. Why: queries multiply and memory grows with the table.
- **di-lifetime**: Service lifetimes match their dependencies. Flag: a singleton taking a scoped service (DbContext, a per-request service) in its constructor, a `DbContext` held in a static or singleton, a scoped service resolved from the root provider in a background service without `CreateScope`. Why: captive dependencies share a DbContext across threads and corrupt state.
- **httpclient-use**: Outbound HTTP goes through `IHttpClientFactory` or a long-lived `HttpClient`, with a timeout and resilience policy where the repository uses one. Flag: `new HttpClient()` per call, a client with no timeout calling a slow dependency, retries added on non-idempotent POSTs. Why: socket exhaustion and stale DNS, or duplicated writes.
- **dispose**: `IDisposable` and `IAsyncDisposable` objects created by the code are disposed with `using`/`await using`. Flag: a stream, `SqlConnection`, `CancellationTokenSource` or timer created and never disposed, a DI-owned service disposed manually. Why: handle and connection leaks under load.
- **exception-handling**: Exceptions are handled once with their context. Flag: an empty `catch`, `catch (Exception) { return null; }`, `throw ex;` that resets the stack (use `throw;`), logging `ex.Message` without the exception. Why: the cause of the failure is lost.
- **contract-change**: Changes to entities, DTOs serialised to clients and public types are deliberate and paired with a migration. Flag: a renamed or removed entity property with no EF migration, a changed JSON property name, a public method signature change in a shared library, a new non-nullable column with no default. Why: data or clients break at deploy.

## Fix

- Prefer: `async`/`await` end to end with `CancellationToken`, DTO records with validation, `IHttpClientFactory`, `AsNoTracking()` for reads, projections with `Select`, and the repository's existing authorization policies.
- Never touch: `Program.cs` middleware order and authentication setup beyond the endpoint in the PR, `.csproj` package versions, and existing EF migrations.
- Escalate: `endpoint-authz` and `contract-change` breaks, new EF migrations, and changes to service lifetimes in shared registration code.
