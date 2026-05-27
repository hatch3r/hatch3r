---
id: hatch3r-rust-patterns
type: rule
description: Rust conventions covering 2024 edition idioms, error handling with thiserror/anyhow, ownership patterns, async with Tokio, testing, and Cargo workspaces
scope: conditional
globs: "**/*.rs,**/Cargo.toml,**/Cargo.lock,**/rustfmt.toml,**/.rustfmt.toml,**/clippy.toml,**/.clippy.toml,**/rust-toolchain,**/rust-toolchain.toml"
tags: [implementation, lang:rust]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Rust Patterns

> Applies when the project ships a Rust crate or workspace. Detection signals: `Cargo.toml` at repo root, `*.rs` source files, or `rust-toolchain.toml` pinning a specific toolchain.

## Rust Language Floor

- Target the Rust 2024 edition (`edition = "2024"` in `Cargo.toml`). Adopted patterns: `let-else`, async closures, `if let` chains. Pin the toolchain in `rust-toolchain.toml` to the latest stable for reproducible builds.
- Treat `cargo clippy --all-targets --all-features -- -D warnings` as a build gate. Configure `clippy.toml` with `msrv` and project-specific lints (`disallowed-methods`, `cognitive-complexity`).
- Format with `cargo fmt --all -- --check` in CI. Use `rustfmt.toml` to pin style (e.g., `edition = "2024"`, `imports_granularity = "Crate"`).
- Treat `cargo doc --no-deps --document-private-items` warnings as errors — missing doc on public items blocks merge.

## Project Layout

- Single crate: `src/lib.rs` for library code, `src/main.rs` or `src/bin/<name>.rs` for binaries. Avoid mixing — separate library and binary into a workspace.
- Cargo workspaces for multi-crate repos: top-level `Cargo.toml` with `[workspace]`, crates under `crates/<name>/`. Use `[workspace.dependencies]` for shared version pinning.
- Public API exposed via `pub use` re-exports in `lib.rs` — internal modules stay `pub(crate)`. Stop exporting implementation details accidentally.
- Avoid `#[allow(...)]` outside test code. When unavoidable, comment with the reason and link to a tracking issue.

## Error Handling

- Library crates: define typed errors with `thiserror` (`#[derive(Error)]`). Implement `std::error::Error` and `Display`; do not implement them manually.
- Binary crates: use `anyhow::Result<T>` for top-level error propagation with `.context("...")` annotations. Convert library errors via `From` impls or the `?` operator.
- Never `unwrap()` or `expect()` in library code outside test fixtures. Use `.ok_or(...)` / `.ok_or_else(...)` to convert `Option` to `Result`.
- Use `Result<T, E>` consistently. Never use `panic!` for recoverable errors. `assert!` in production code is a smell — convert to typed errors.

## Ownership & Borrowing

- Prefer owned `String` and `Vec<T>` in function signatures when the function will store the value. Use `&str` / `&[T]` for read-only inspection — Clippy's `needless_pass_by_value` flags violations.
- Use `Cow<'_, str>` when the function may or may not modify the input. Stop cloning to "make the borrow checker happy".
- For shared ownership: `Arc<T>` across threads, `Rc<T>` single-threaded. Wrap interior mutability with `Mutex`, `RwLock`, `parking_lot::Mutex` (no poisoning) — never `RefCell` across threads.
- Document lifetime parameters when they affect the public API. Names like `'a` are placeholders; rename to `'src` / `'cfg` / `'req` when the meaning is non-trivial.

## Async with Tokio

- Tokio is the async-runtime floor for most projects (`tokio = "1"` with the `rt-multi-thread` feature). Use `async-std` only if a specific dependency requires it; document the reason.
- Mark the entrypoint with `#[tokio::main(flavor = "multi_thread", worker_threads = N)]` for binaries. For tests, `#[tokio::test]` with the `current_thread` flavor unless the test exercises real parallelism.
- Never block in async code — `std::sync::Mutex::lock` blocks; use `tokio::sync::Mutex` for async-aware locking. CPU-bound work goes through `tokio::task::spawn_blocking`.
- Cancellation: prefer structured concurrency via `tokio::select!` + `CancellationToken`. Avoid dropping `JoinHandle` to "cancel" — the task continues running until it yields.
- Timeouts: wrap I/O with `tokio::time::timeout(duration, fut)`. Tokio futures are cancel-safe only at `await` points — design around that.

## Testing

- Unit tests in `#[cfg(test)] mod tests { ... }` blocks next to the code. Integration tests in `tests/<name>.rs` at the crate root.
- Property-based testing with `proptest` for parser / serializer / state-machine logic. `proptest!` generates random inputs and shrinks failing cases.
- Snapshot testing with `insta` for serialized output (JSON, OpenAPI, generated code). Update snapshots through PR review — never blanket-update.
- Mocking: `mockall` for trait-based mocking. Hand-rolled fakes are fine when the trait has ≤3 methods. Avoid `mock_it` / `faux` (less maintained).
- Coverage: `cargo llvm-cov` for coverage reports. Floor: 80% line coverage in `src/`, 90% for critical modules (security, billing, persistence).
- Fuzz testing with `cargo-fuzz` (`#[no_main] fuzz_target!`) for untrusted-input parsers. At least one fuzz target per public-facing parser.

## Concurrency Idioms

- For parallel CPU work: rayon (`rayon::iter::*`). Avoid threading directly with `std::thread::spawn` outside of long-running infrastructure (e.g., a background worker pool).
- For async fan-out: `tokio::task::JoinSet` (preferred over `FuturesUnordered` for managed cancellation) or `futures::stream::buffered_unordered`. Bound concurrency explicitly — never spawn unbounded.
- Channels: `tokio::sync::mpsc` (async), `crossbeam_channel` (sync, high-throughput). `std::sync::mpsc` is legacy — use the alternatives.
- Shared state with `Arc<RwLock<T>>` — keep critical sections small. Holding a lock across an `.await` is a deadlock risk; the compiler does not flag it.

## Performance

- Profile with `cargo flamegraph` (Linux/macOS) or `samply` (cross-platform) before optimizing. Optimizing without a profile is guessing.
- Use `cargo bench` with `criterion` for micro-benchmarks. Pin baselines in `target/criterion/` and compare in CI.
- Compile-time flags: `RUSTFLAGS="-C target-cpu=native"` for binaries pinned to a known deployment environment. Cross-compiled binaries leave `target-cpu=native` off.
- Release profile in `Cargo.toml`:
  ```toml
  [profile.release]
  lto = "thin"
  codegen-units = 1
  strip = true
  ```
- Inline functions only after profiling. `#[inline]` hints, not commands; over-inlining bloats the binary and slows compilation.

## Dependency Hygiene

- Pin `Cargo.lock` for binary crates; ignore for library crates. The `cargo lock-not-in-vcs` warning calls this out.
- Vulnerability scanning: `cargo audit` in CI against the RustSec advisory database. Block merge on advisory matches without an acknowledged remediation.
- License compliance: `cargo deny check licenses` with an allowlist in `deny.toml`. Block GPL contamination via the allowlist.
- Supply-chain: prefer crates with named maintainers, recent activity (≤6 months since last release), and >100 downloads/day. Pin transitive dependencies via `Cargo.lock` and re-verify on every `cargo update`.

## Unsafe Code

- `unsafe` blocks require a `// SAFETY:` comment explaining why the invariant holds. Reviewer cannot approve `unsafe` without the rationale.
- Clippy lint `clippy::missing_safety_doc` is a build gate for `unsafe fn` declarations.
- Prefer safe abstractions even if they cost performance. Optimize after profiling, with a measurable target.

## References

- Rust 2024 edition: https://doc.rust-lang.org/edition-guide/rust-2024/index.html (accessed 2026-05-27, official-docs)
- Rust API Guidelines: https://rust-lang.github.io/api-guidelines/ (accessed 2026-05-27, official-docs)
- Tokio tutorial: https://tokio.rs/tokio/tutorial (accessed 2026-05-27, official-docs)
- Cargo Book: https://doc.rust-lang.org/cargo/ (accessed 2026-05-27, official-docs)

## Cross-References

- `rules/hatch3r-api-design.md` — REST/GraphQL/gRPC contract floors apply to Rust services (Axum/Tonic).
- `rules/hatch3r-testing.md` — coverage thresholds carry over to `cargo llvm-cov`.
- `rules/hatch3r-observability-logging.md` — `tracing` crate integration with the canonical logging contract.
