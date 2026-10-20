---
name: go
description: Go rules for a code review. Flags code that leaks goroutines, races, loses errors or hangs in production in ways go vet and staticcheck do not catch. Covers context not passed or ignored, goroutines with no way to stop, unsynchronised shared state, errors dropped or wrapped without %w, resources not closed, HTTP servers and clients with no timeouts, SQL and commands built from input, panics in library code, nil maps and interfaces holding typed nils, unbounded concurrency, and exported API changes. Use as a review lens or as a stamp rule pack.
---

# go

Go makes concurrency cheap and failure explicit, which makes both easy to get
quietly wrong. Review whether this change lets every goroutine finish,
carries cancellation through, keeps every error, and releases what it opens.

## Review

- **context-flow**: A function that does I/O or may block takes `ctx context.Context` first and passes it down, and long loops check `ctx.Done()`. Flag: `context.Background()` or `TODO()` inside a request path, a ctx accepted but not passed to the database or HTTP call, a `select` on a channel with no `ctx.Done()` case. Why: cancelled requests keep running and hold connections after the client left.
- **goroutine-lifetime**: Every goroutine has a way to stop and an owner that waits for it (`errgroup`, `WaitGroup`, a done channel). Flag: `go func()` in a handler with no cancellation, a goroutine blocked forever sending on an unbuffered channel nobody reads, a ticker never stopped. Why: goroutine leaks grow until the process runs out of memory.
- **data-race**: State shared between goroutines is guarded by a mutex, an atomic, or owned by one goroutine behind a channel. Flag: a map written from more than one goroutine, a struct field updated in a goroutine and read in the caller, a loop variable captured in Go before 1.22 semantics, a `sync.Mutex` copied by value. Why: races corrupt data and crash with `concurrent map writes`, intermittently.
- **error-handling**: Errors are checked, and wrapped with `%w` and context when returned. Flag: `_ =` or an ignored error from a write, close or commit; `fmt.Errorf("...: %v", err)` where callers use `errors.Is`/`As`; comparing `err.Error()` strings; logging an error and also returning it. Why: failures disappear, or callers can no longer tell which error happened.
- **resource-close**: Opened files, response bodies, rows, statements and transactions are closed or rolled back on every path, close errors on writes are checked. Flag: `resp.Body` not closed, `rows` not closed or `rows.Err()` unchecked, a transaction with no deferred rollback, `defer f.Close()` on a file written to with the error ignored. Why: connection pools exhaust and writes are lost silently.
- **http-timeouts**: `http.Server` sets `ReadHeaderTimeout` (and usually read, write and idle timeouts), and `http.Client` has a `Timeout` or per-request context deadline. Flag: `http.ListenAndServe` with the default server, `http.DefaultClient` or `&http.Client{}` for outbound calls. Why: slowloris holds the server, and a hung dependency holds every goroutine.
- **injection** [refuse]: SQL takes input through placeholders, commands through `exec.Command` argument lists, file paths through a containment check. Flag: `fmt.Sprintf` into a query, `exec.Command("sh", "-c", input)`, `filepath.Join(root, userPath)` with no check that the result stays under root, `template.HTML` from user input. Why: injection and path traversal.
- **no-library-panic**: Library and request code returns errors instead of panicking, and recovers at goroutine boundaries the program starts. Flag: `panic` on bad input, `log.Fatal` or `os.Exit` outside `main`, a goroutine with no recover in a server where one panic kills the process. Why: one bad request takes the whole service down.
- **nil-traps**: Writes go to initialised maps, and functions returning an interface return a literal `nil` on success. Flag: writing to a nil map field, `var err *MyErr; return err` as an `error`, dereferencing an optional pointer field without a check. Why: panics in production, and `err != nil` true for a nil pointer.
- **bounded-concurrency**: Fan-out over input is bounded (`errgroup.SetLimit`, a semaphore, a worker pool). Flag: `for _, x := range items { go work(x) }` over request or database-sized input, an unbounded buffered channel used as a queue. Why: a large input spawns thousands of goroutines and connections at once.
- **exported-contract**: Changes to exported identifiers, struct fields marshalled to JSON, and error values callers match are deliberate. Flag: a renamed or removed exported function or field, a changed `json:` tag, a sentinel error replaced by a new one, a new required argument on a widely used function. Why: downstream packages and stored data break at the next build or deploy.

## Fix

- Prefer: `errgroup` with a context, `fmt.Errorf("doing x: %w", err)`, `defer` close and rollback right after the open succeeds, and the repository's existing HTTP client and database helpers.
- Never touch: `go.mod` versions, generated code (`*.pb.go`, `*_gen.go`), and vendored packages.
- Escalate: `exported-contract` breaks, changes to server timeouts or pool sizes, and any switch of concurrency model across a package.
