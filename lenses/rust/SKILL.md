---
name: rust
description: Rust rules for a code review. Flags code that compiles and passes clippy but panics, blocks, leaks or breaks soundness in production. Covers unsafe blocks without a SAFETY argument, unwrap and expect on fallible input, panics across FFI, blocking calls in async code, locks held across await, unbounded channels and spawns, lost errors, integer overflow in release builds, untrusted deserialisation limits, SQL and commands built from input, and public API and serde changes. Use as a review lens or as a stamp rule pack.
---

# rust

The compiler proves memory safety outside `unsafe`; it does not prove the
program stays up. Review whether this change keeps every `unsafe` justified,
turns bad input into errors rather than panics, and keeps async code from
stalling the runtime.

## Review

- **unsafe-justified** [refuse]: Every `unsafe` block or `unsafe impl` (`Send`, `Sync`) carries a `// SAFETY:` comment naming the invariant that makes it sound, and the invariant actually holds in the code around it. Flag: a new `unsafe` with no SAFETY comment, a comment that restates the code, `transmute` between types without a documented layout guarantee, `get_unchecked` with no bounds argument, `unsafe impl Send` for a type holding `Rc` or a raw pointer. Why: unsoundness is undefined behaviour, the one failure Rust otherwise rules out.
- **no-panic-on-input**: Code that handles input, network data, files or configuration returns errors rather than panicking. Flag: `.unwrap()`, `.expect()`, indexing `v[i]`, slicing `&s[a..b]` on byte offsets, or `unreachable!()` on values that come from outside the program. Why: one malformed request aborts the task or the process.
- **ffi-panic**: A function called from C (`extern "C"`) or another language catches panics and turns them into an error code. Flag: an `extern "C" fn` that can panic with no `catch_unwind`, a callback passed to C that can unwind. Why: unwinding across FFI aborts the process or is undefined behaviour.
- **async-blocking**: Async code never blocks the executor thread. Flag: `std::fs`, `std::thread::sleep`, `std::sync::Mutex` held over work, a blocking database or HTTP client, or heavy CPU loops inside an `async fn` without `spawn_blocking`. Why: one blocked worker thread stalls every task scheduled on it.
- **lock-across-await**: No lock guard (std or `tokio::sync`) is held across an `.await` unless that is the intent and the lock is async. Flag: a `MutexGuard` alive across `.await`, `RefCell` borrows held across `.await`. Why: deadlocks, or futures that are not `Send` and fail far from the change.
- **bounded-async**: Channels and task spawning are bounded. Flag: `unbounded_channel` fed by external input, `tokio::spawn` per request item with no limit or `JoinSet`, a spawned task whose `JoinHandle` is dropped while its errors matter. Why: memory grows under load and failures vanish.
- **error-context**: Errors keep their source and context. Flag: `.map_err(|_| ...)` that drops the original error, `Box<dyn Error>` in a library's public API where callers need to match, `let _ = ` on a `Result` from a write or send, `.ok()` that hides a failure the caller should see. Why: the cause of the incident is gone from logs.
- **overflow**: Arithmetic on sizes, lengths, counts, money or values from input uses `checked_`, `saturating_` or `wrapping_` deliberately. Flag: `a + b`, `a * b` or `as` casts between integer widths on external values. Why: release builds wrap silently, producing wrong lengths and allocations.
- **untrusted-decode** [refuse]: Deserialisation of untrusted input sets size and depth limits and never trusts lengths from the data. Flag: `bincode` or similar with no size limit on network input, `Vec::with_capacity(len_from_input)`, reading a whole request body with no cap. Why: one small message allocates gigabytes.
- **injection** [refuse]: SQL takes input through bind parameters, commands through `Command::arg`, paths through a containment check. Flag: `format!` into a query string, `Command::new("sh").arg("-c").arg(input)`, `root.join(user_path)` without checking the result stays under root. Why: injection and path traversal.
- **public-contract**: Changes to public items, trait definitions and serde shapes are deliberate and versioned. Flag: a removed or renamed `pub` item, a new required trait method without a default, a changed `#[serde(rename)]`, removed `#[serde(default)]` on a stored type, a new variant on a public enum without `#[non_exhaustive]`. Why: downstream crates and stored data break.

## Fix

- Prefer: `?` with the repository's error type (`thiserror` in libraries, `anyhow` with `.context()` in binaries), `spawn_blocking`, `tokio::sync` primitives, bounded channels, and checked arithmetic.
- Never touch: `Cargo.toml` features and versions, `build.rs`, generated bindings, and `#![forbid(unsafe_code)]` or lint attributes.
- Escalate: any new or changed `unsafe` block, `public-contract` breaks, and changes to the async runtime configuration.
