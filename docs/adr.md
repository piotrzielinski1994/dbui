# Architectural Decisions — dbui

Append-only log of architectural and design decisions made during development.

## Format

Each entry follows this structure:

| Date | Decision | Rationale |
|------|----------|-----------|
| {YYYY-MM-DD} | {What was decided} | {Why this choice was made} |

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-19 | Desktop shell via Tauri 2 (not Electron) | Smaller bundle, native webview, Rust backend; core platform choice, expensive to swap |
| 2026-06-19 | Adopt TanStack ecosystem (Router/Query/Table/Form/Hotkeys) | Single coherent stack; permeates whole frontend architecture |
| 2026-06-19 | Mirror sibling `requi` bootstrap stack and structure | Both are minimal Tauri desktop tools; one shared mental model reduces context-switching cost |
| 2026-06-19 | Code-based TanStack Router (not file-based) | Fewer build plugins; matches requi |
| 2026-06-19 | App-wide QueryClient `retry: false` | Queries are local Tauri IPC calls, not flaky network; retry-with-backoff only delays surfacing real errors |
| 2026-06-19 | Neutral `greet` IPC in bootstrap, no DB driver bundled | Keep scaffold pure stack-proof; the DB driver choice is its own decision for a later feature |
