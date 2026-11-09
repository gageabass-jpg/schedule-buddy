# Nucleus Wagonwheel

Personal project management for the Mac. Projects, tasks, subtasks, milestones, notes, an inbox, a calendar and a Gantt timeline, in a red Apple-glass window.

- **Local only.** Everything is stored in one SQLite file on this Mac. No account, no cloud, no network. The built page forbids network connections, and a test checks that no request leaves the machine.
- **Electron + React + Vite + TypeScript**, like Nucleus Manager. SQLite is `node:sqlite`, which is part of Electron's Node. There is no native module to rebuild.
- **Independent.** It builds, runs and tests without Nucleus Manager (`desktop/`). It does compile the shared primitives in `../shared-ui`.

## Run it

```bash
cd wagonwheel
npm install
npm run dev        # Vite + Electron, with hot reload
```

```bash
npm run build      # renderer to dist/, main process to dist-electron/
npm start          # run the built app
npm run dist       # a .dmg for Apple Silicon (release/)
```

## Where the data is

`~/Library/Application Support/Nucleus Wagonwheel/wagonwheel.db`

Use **workspace menu → Show data folder**, or File → Back Up Database…. To move to another Mac, back up and restore.

| In the app | What it does |
|---|---|
| **Back up database…** | A consistent single-file copy of the live database (SQLite's own backup). |
| **Export as JSON…** | Everything in one file. |
| **Export as CSV…** | `projects.csv`, `tasks.csv`, `milestones.csv`, `notes.csv` in a new folder. UTF-8 with a BOM for Excel; cells that start with `=`, `+`, `-` or `@` are neutralised. |
| **Restore from backup…** | Checks the file (integrity, schema), asks, saves your current workspace first as `before-restore-….db`, then swaps. |

If the database file cannot be opened, the app says why and offers *Start a new workspace*. That keeps the unreadable file under another name and never deletes it.

## Shortcuts

⌘N new task · ⇧⌘N new project · ⌘L capture to the inbox · ⌘1–5 Dashboard, All Projects, All Tasks, Timeline, Inbox.

## Layout

```
electron/            main process
  db/                the whole data layer: schema, migrations, CRUD, backup, export
  data-service.ts    files and dialogs (the only code that touches the disk)
  ipc.ts, preload.mts, menu.ts, main.ts
shared/              the contract between main and renderer (types, API)
src/                 renderer
  lib/               dates, dashboard and calendar maths, store, UI state
  components/        sidebar, calendar, dialogs, task row, glass kit
  views/             dashboard, projects, project, tasks, inbox, day, timeline
  styles/            index.css (the theme: every colour) and glass.css (the glass layers)
e2e/                 Playwright-driven tests of the real app, and the screenshot baseline
build/               app icon (icon.svg is the source of icon.png)
```

### The database

`PRAGMA user_version` holds the schema version. To change the schema, **append** a migration in `electron/db/migrations.ts`; never edit one that has shipped. A database with data in it is copied to `wagonwheel.db.before-vN.bak` before it is migrated. A database from a newer version of the app is refused, not guessed at.

A project's progress is the share of its top-level tasks that are done (a subtask is part of its task). A task with no project is *unsorted*: it is in the inbox until it gets one.

SQLite is the only source of truth. Each change goes to the main process, runs in one transaction, and returns the whole workspace. That is simple and always consistent, and it is fast at personal scale (thousands of tasks). If you ever have tens of thousands, change `snapshot()` to send patches.

## Shared components, and the rule

Wagonwheel uses the primitives in `../shared-ui` (alias `@nucleus/ui`): Tabs, Popover, Tooltip, the animated circle-check / trash / triangle-alert icons, the loading orbit, the Nucleus mark, the timeline axis maths, `cn()`, the toast emitter, and the shared Button (inside `GlassButton`).

> **Wagonwheel never changes `shared-ui/` or `desktop/`.** If a shared component does not do what is needed, write a wrapper or a new component here (see `components/GlassButton.tsx`). Style shared components with the CSS variables in `src/styles/index.css` and with `className`. CI rejects a pull request that breaks this. See `../docs/nucleus-protection.md`.

Things Wagonwheel does itself because the shared version does not fit: the Gantt (zoom limits for months-long projects, bars, drag), the calendar with markers, the dialogs, the toast host. Shared components Wagonwheel does not use: the shiny, pixel and gradient buttons and the chart tooltip, which do not belong in this interface.

## Tests

```bash
npm test                 # 57 unit tests: SQLite layer, exports, dates, dashboard maths, colours
npm run typecheck
npm run lint
npm run test:e2e         # builds, then drives the real app (19 tests + 6 tests of the screenshot comparison)
```

On Linux the end-to-end tests start a virtual display for you (`xvfb-run`). On a Mac they open real windows for a moment.

The end-to-end suite creates, edits, completes and deletes projects, tasks, subtasks, milestones and notes through the window; checks the inbox, the calendar, and dragging on the timeline; closes and reopens the app to prove the data stays; backs up, exports and restores; opens a corrupt database; and checks that nothing leaves the machine.

### The screenshot test

`e2e/baseline/dashboard.png` is the dashboard with sample data on a fixed date (2026-06-01), 1440×900.

It is **not** compared pixel by pixel. The same build draws text with slightly different edge softness on different machines. A GitHub runner differed from the machine that made the baseline in 12,100 pixels, all of them glyph edges, which is more than a recoloured button. So both pictures are averaged into 6×6 blocks first, and two things are checked:

| Check | Limit | Measured |
|---|---|---|
| blocks that differ visibly | 10 | runner: 1. A recoloured chip: 126. A recoloured button: 166. The title strip changed: 255. |
| mean colour of the whole picture, per channel | 1.0 level | runner: 0.04. A subtle +6 tint: 6.0. |

It does **not** see a few changed letters in small text. Test text with the end-to-end assertions. After a **deliberate** visual change:

```bash
UPDATE_SNAPSHOTS=1 npm run test:e2e   # then LOOK at e2e/baseline/dashboard.png before committing it
```

On a failure, CI uploads `e2e/artifacts/` (the actual picture and a full-resolution diff). Run locally with `npm run test:e2e`; the same folder appears in `wagonwheel/e2e/artifacts/`.

## Design

Dark red glass. `src/styles/index.css` holds every colour; the shared primitives read the shadcn variable names, so they come out red with no edits. Measured contrast: warm white 15.5:1 on a card, soft grey 8.5:1, dim grey 5.3:1. Raw crimson `#C62845` is only 3.2:1 on a card, so it is a **fill** (white on it is 5.5:1) and never text; red text uses `#F0728A` (6.2:1). Overdue is coral, not crimson, so it never reads as the brand colour. Fonts (Sora, Source Sans 3) are bundled, so the app looks the same offline.
