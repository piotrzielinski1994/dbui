# F12 - Commit/rollback confirmation layer (prod safety)

Feature folder: `docs/features/20260710211859-commit-rollback-confirmation/`
Branch: `20260710211859-commit-rollback-confirmation`
Source: `.pzielinski/todos.md` F12. Full task file: `.pzielinski/F12.md`.

## Overview

Per-database **Confirm writes** toggle (Settings tab, persisted in `workspace.json`, mirrors the
F11 `readOnly` flag). When ON, a write does NOT reach the backend immediately - it opens a
confirmation dialog showing the exact SQL / Mongo command with **Commit** (send) and **Cancel**
(discard the intent) buttons. When OFF (default) writes send immediately, exactly as today.

This is a FRONTEND confirm-before-send gate with NO backend change, mirroring F11's boundary
architecture. It is NOT a real DBeaver-style manual-commit transaction (BEGIN/hold/COMMIT on a
pinned connection) - that remains a larger separate feature (see `docs/adr.md` 2026-07-10).

The two gated write paths are the only two frontend DB-send sites (same as F11):
1. Table card Save (`apply_mutations`).
2. SQL / Query tab Run of a write-shaped statement (`isWriteSql` / `isWriteMongo`).

`readOnly` takes precedence: a read-only DB blocks the write outright (F11) and never shows the
confirm dialog.

## Acceptance Criteria

See `.pzielinski/F12.md` (AC-001 .. AC-008). Summary:

- Settings toggle reflects + flips `confirmWrites` (AC-001).
- `confirmWrites` persists, omitted when false (AC-002).
- Confirm ON gates table Save behind a Commit dialog (AC-003).
- Confirm ON gates write-shaped SQL Run behind a Commit dialog (AC-004).
- Reads never gated (AC-005).
- Confirm OFF = no regression (AC-006).
- `readOnly` wins (AC-007).
- Garbage persisted value dropped, no crash (AC-008).

## User Test Cases

TC-001 .. TC-009 in `.pzielinski/F12.md`.

## Data Model

`DatabaseNodeBase` gains `confirmWrites: boolean` (next to `readOnly`). Persisted shape gains
optional `confirmWrites?: boolean` on all three node variants; merge keeps only `true`, hydrate
defaults false, dehydrate omits false. Byte-for-byte mirror of `readOnly`.

## Edge Cases

- `readOnly` + `confirmWrites` both ON: read-only block runs first, dialog never appears.
- Read-shaped SQL under confirm ON: passes through immediately.
- Non-boolean persisted `confirmWrites`: dropped, treated false.
- Cancel on the SQL Run dialog: nothing sent, no History entry.

## Dependencies

None. Pairs with F11 (read-only). No backend change, no new Tauri command, no new dep.
