# Nucleus Wagonwheel

Personal project management for the Mac. Electron, React, Vite, TypeScript, local SQLite (`node:sqlite`). No account, no cloud.

## Status: work in progress

This folder is a **partial scaffold**. It does not run yet: the renderer has no `main.tsx` or `App.tsx`.

| Part | State |
|---|---|
| SQLite layer (`electron/db/`): schema, migrations, CRUD, backup, restore check, JSON/CSV export | Written. 55 unit tests pass (`npm test`). |
| Electron main, preload, menu, IPC (`electron/`) | Written. Type-checks. Not yet run end to end. |
| Data contract (`shared/`) | Written. |
| Renderer logic (`src/lib/`): dates, derived data, store, UI state | Written. Tested. |
| Glass theme (`src/styles/`), UI kit, title bar, calendar, toasts | Started. |
| Sidebar, dashboard, projects, tasks, timeline, inbox, dialogs, `App.tsx` | **Not written.** |
| Playwright-Electron tests (`e2e/`) | **Not written.** |
| CI job | **Not added.** |

## Shared components

Primitives come from `../shared-ui` (alias `@nucleus/ui`). **Never edit `shared-ui/` or `desktop/` from this app.** Style the primitives with the CSS variables in `src/styles/index.css` and with `className`. See `../shared-ui/README.md`.

## Commands

```bash
npm install
npm test          # unit tests (no window needed)
npm run typecheck
```
