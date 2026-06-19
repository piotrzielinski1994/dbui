# Learnings

Project-specific conventions, gotchas, and constraints worth recording so future-you (human or agent) doesn't re-derive them. Append-only. For architectural trade-offs use [adr.md](adr.md) instead.

## Entries

<!-- Format: one bullet per learning. Date prefix optional. -->

- TanStack Hotkeys split: `@tanstack/hotkeys` is the framework-agnostic core (no React hook). The React `useHotkey` + `HotkeysProvider` live in `@tanstack/react-hotkeys`. Install the adapter, not the core.
- Hotkey strings are case-sensitive in the typed union: use uppercase keys, e.g. `"Mod+K"` not `"Mod+k"`.
- Under jsdom the hotkeys lib resolves `Mod` to `Control` (test platform reports non-mac), so hotkey tests fire `{Control>}k{/Control}`, not Meta.
- ESLint react-hooks v7 false-positives: `useReactTable` trips `react-hooks/incompatible-library`; code-based TanStack route files trip `react-refresh/only-export-components`. Both scoped off in eslint.config.js for the relevant paths.
- shadcn Button keeps `react-refresh/only-export-components` as an accepted warning (canonical upstream file exports `buttonVariants` alongside the component). Lint exits 0 with warnings.
- Bootstrap scaffold was ported from the sibling `requi` repo (same Tauri 2 + React 19 + TanStack stack), not generated fresh from `npm create tauri-app`. Identity rewritten: package name, Cargo `name`/`_lib`, `tauri.conf.json` productName/identifier, `main.rs` lib ref.
