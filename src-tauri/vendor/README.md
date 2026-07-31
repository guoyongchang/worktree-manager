# Vendored Rust crates

## tao 0.34.5

`tao-0.34.5` is the unmodified crates.io release with one Windows ownership
backport from [tauri-apps/tao#1290](https://github.com/tauri-apps/tao/pull/1290):
the internal `EventLoopRunnerShared` reference count uses `Arc` instead of
`Rc`.

Tauri can clone and drop the containing runtime context across threads on
Windows. A non-atomic `Rc` count can therefore become corrupted, free the event
loop runner prematurely, and later terminate the process in Rust's refcount
guard. The observed production signature was `STATUS_ILLEGAL_INSTRUCTION
(0xC000001D)` at the guard's `ud2` instruction.

Source crate:

- Name/version: `tao 0.34.5`
- crates.io SHA-256:
  `f3a753bdc39c07b192151523a3f77cd0394aa75413802c883a0f6f6a0e5ee2e7`
- Upstream fix commit:
  `5c361e12922ecbec3eac005d1c6ffca0ca6294c6`

Keep the vendored package version at `0.34.5`; `tauri-runtime-wry 2.10.x`
requires Tao `0.34.x`. Remove the `[patch.crates-io]` override after an
official compatible Tao/Tauri release contains the upstream fix.
