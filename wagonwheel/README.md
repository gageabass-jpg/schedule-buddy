# Nucleus Wagonwheel

Personal project management for the Mac. Projects, tasks, subtasks, milestones, notes, an inbox, a calendar and a Gantt timeline, in a red Apple-glass window.

- **Local by default.** Everything is stored in one SQLite file on this Mac. No account, no cloud. The built page forbids network connections, and a test checks that no request leaves the machine. The one exception is the optional [GitHub scan](#scan-github-for-tasks), which runs only when you start it, in the main process, and talks only to `github.com` and `api.github.com`.
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
| **Export as CSV…** | `projects.csv`, `tasks.csv`, `milestones.csv`, `notes.csv`, `services.csv`, `service_charges.csv` in a new folder. UTF-8 with a BOM for Excel; cells that start with `=`, `+`, `-` or `@` are neutralised. |
| **Restore from backup…** | Checks the file (integrity, schema), asks, saves your current workspace first as `before-restore-….db`, then swaps. |

If the database file cannot be opened, the app says why and offers *Start a new workspace*. That keeps the unreadable file under another name and never deletes it.

## Shortcuts

⌘N new task · ⇧⌘N new project · ⌘L capture to the inbox · ⇧⌘G scan GitHub · ⌘, connectors · ⌘1–6 Dashboard, All Projects, All Tasks, Timeline, Inbox, Services.

## Scan GitHub for tasks

The **Scan GitHub** button in the page header, beside New task and New project on the Dashboard, All Tasks and All Projects (or File → Scan GitHub for Tasks…, ⇧⌘G, from anywhere). Below a 1280px-wide window it shows the branch icon alone. The **Inbox** button, an icon with the count of unsorted tasks, is in the same corner of every page header, behind a thin divider; it replaces the two rows the sidebar used to carry. Each repository you pick is read, and the scan *suggests* tasks for it. You tick the ones you want; nothing is added until you press the button.

| It reads | It suggests |
|---|---|
| Open issues | A task each, most important first (bug and urgent labels are high, docs and chores low). A GitHub milestone's due date becomes the task's due date. |
| Pull requests | "Finish" your drafts, "Merge or close" your open ones and bots' (low priority), "Review" the ones other people opened or asked you to review (high). |
| Milestones | A Wagonwheel milestone when it has a due date; otherwise a "Finish milestone" task. |
| README, TODO and ROADMAP files (root and `docs/`) | Unchecked `- [ ]` items, and the top-level bullets under a heading like Roadmap, TODO, Planned or Known issues. |

### Connecting a repository to a project

Open a project and press **Connect GitHub repo** (under its description). Pick the repository, or paste `owner/name` or any github.com address, then choose **Connect and scan** or **Connect only**. The project then shows the repository, with **Scan for tasks** (the same review, straight to this project, no picking) and a **Disconnect** button (the project's tasks stay).

- A repository belongs to **one project**. Another project cannot take it: the list shows it as connected, and the database refuses it too (a unique index on `projects.github_repo`, added by migration 2, compared without regard to case).
- A scan always goes to the project connected to the repository. With none connected, it uses an existing project that is not connected to anything and is named like the repository or holds its address in its description, and connects that one now. With none of those, it makes a new project, already connected.
- The connection is stored on the project (`projects.github_repo`, `owner/name`), so it is in backups, the JSON export and `projects.csv` (`github_repo`). A project card on the projects list shows the repository.

A second scan skips what is already there: it finds a task by the `From GitHub: <link>` line in its description, a roadmap item by its title, a milestone by its name.

**Signing in** uses GitHub's *device flow* with an OAuth app you own, so there is no secret in the app and nothing is shared with anyone else. The first time, the dialog walks you through making the app (about a minute) and asks for its Client ID, which is not a secret. Then you type a short code on github.com. The token is encrypted with the Mac's keychain (Electron `safeStorage`) and kept in its own file, `github.json`, beside the database: never inside it, so a backup, an export or a restore cannot carry it away. It lives only in the main process; the window never sees it. Private repositories need GitHub's `repo` scope (GitHub has no read-only one for private code); untick the box to ask for public repositories only. The app only ever sends GET requests. To revoke it, remove the app under github.com/settings/applications. **Sign out** forgets the token on this Mac.

## Services: what you pay each month

**Sidebar → Services** (⌘6). A list of what the workspace pays for (Supabase, Vercel, GitHub, Google Workspace, Firebase / Google Cloud, Cursor, Claude Code, or anything else), with this month's total next to last month's, the change, and what each service charges.

Each service has a **plan**, a **type** (*Flat fee* is the same every month; *Usage-based* moves with use and can surprise you), a **usual monthly fee**, a **billing day**, and a **billing page** (an `https://` address only, so a link can never run a script or open a file). **Add service** offers seven starting points (the five named above, plus Cursor and Claude Code); their prices are left blank on purpose, since they change.

- **A month's figure** is what was recorded for it, or the usual fee standing in (shown with a `~` and "usual fee, not yet billed"). Type a bill into the box on a row and press Return; typing another for the same month replaces it.
- **Higher than usual.** A bill that is at least $10 and at least a quarter over the usual fee (or over last month's bill, when no usual fee is set) puts a notice at the top of the screen and turns the sidebar count red. This is what would have caught a flat $150 plan nobody meant to keep.
- **Cancelled.** Tick *I have cancelled this service* in its dialog: it keeps its bills as history and drops out of any month it was not billed.
- **Stored** in the database (`services`, `service_charges`; migration 3), so it is in backups and the JSON and CSV exports. A service has one figure per month.

### Checking Vercel usage

Vercel is the one service with a billing API (`GET /v1/billing/charges`), and it turns out to report **usage, not invoices**. So the button is **Check usage**, and it never writes a bill. Connect it in the service's dialog (*Check usage automatically*), paste a Vercel token, and press **Check usage** on the Services screen. It adds up the usage Vercel billed beyond what your plan includes, for this month so far and last month, and tells you in a sentence ("Vercel usage billed beyond your plan: less than a cent so far in November 2026 ($0.03 in October 2026). Nothing unusual. Your own bill figures were not changed.").

- **It is a tripwire, not a ledger.** Usage at or above $2, or a tenth of the usual monthly fee when that is more, is called out ("more than a quiet month: check Vercel's usage page"). That is what a runaway function or a bandwidth spike looks like before it becomes a bill. The only thing it changes is the service's *last checked* time.
- **What Vercel's billing API really contains (checked against the real account, 2026-11-11).** It reports usage, day by day (`ChargeCategory: Usage`, 700+ records a day, so a single month is more than 4 MB, which is why the reply is streamed and added up as it arrives rather than loaded whole). `BilledCost` is the usage actually billed beyond the plan, a few thousandths of a dollar a day here (about $0.03 for October). The $20 Pro plan is *not* a charge: it is spread across the billing cycle in `EffectiveCost` (about $0.65 a day under "Subscription Licenses"), before tax. Invoice totals ($21.20 with 6% tax), tax and one-off purchases such as domains are not in it. So the API cannot give "what was charged to the card". An earlier version tried to record those figures as bills, read $0.00, $0.03 and $0.00 for months invoiced at $21.20, and overwrote typed figures; they were restored from the receipts, and bill-writing was removed. Typed-in invoices are the source of truth for Vercel too.
- **Only a service named like Vercel can be linked to Vercel**, so one service cannot be handed another's usage.
- The token is tried on Vercel (against the last hour only, not a month of records) before it is saved, then encrypted with the Mac's keychain and kept in `service-tokens.json` beside the database (never inside it), exactly as the GitHub sign-in is. It lives only in the main process; the window can ask whether a token is saved, never what it is. Nothing is sent except GET requests to `api.vercel.com`, and only when you press the button. Usage in a currency other than US dollars is refused rather than shown wrong.
- **No other provider is checked, on purpose.** Supabase has no billing endpoint in its public API; Google Workspace has none for a normal account; Google Cloud / Firebase cost is only available through a BigQuery billing export; GitHub's user billing report needs a token scope Wagonwheel's sign-in does not ask for; Cursor and Claude Code have no billing API for a personal plan. Type those in.

## Claude Code connector

Wagonwheel can be a connector for [Claude Code](https://claude.com/claude-code): a small MCP server that opens the same database file as the app, so Claude Code can answer "what's due this week?" and add, change and tick off your projects, tasks, milestones and notes, whether or not the app is open. It is installed with the app: nothing else to download, and it runs on the app's own Node (`ELECTRON_RUN_AS_NODE`), so Node need not be installed.

Register it once (Claude Code's user scope, so every project sees it):

```bash
claude mcp add wagonwheel --scope user -e ELECTRON_RUN_AS_NODE=1 -- \
  "/Applications/Nucleus Wagonwheel.app/Contents/MacOS/Nucleus Wagonwheel" \
  "/Applications/Nucleus Wagonwheel.app/Contents/Resources/app.asar/dist-electron/electron/mcp/server.js"
claude mcp list    # wagonwheel: ✓ Connected
```

Add `--read-only` after the second path (or set `WAGONWHEEL_MCP_READONLY=1`) and it offers only the read tools.

### The Connectors panel

You need not type that command: **workspace menu → Connectors…** (or File → Connectors…, ⌘,) shows how things stand and does it for you. It has three cards:

- **Claude Code**: whether Wagonwheel's connector is registered, and pointing at *this* copy of the app ("Connected to another copy" appears if an older install is registered). **Connect to Claude Code** runs Claude Code's own `claude mcp add` (replacing any earlier registration); the **Let Claude Code make changes** box switches between read-and-update and read-only at once; **Disconnect** runs `claude mcp remove`. If the `claude` tool cannot be found it shows the command to copy instead. Sessions already open pick the change up the next time they start.
- **GitHub**: signed in or not, with buttons to scan or sign out.
- **iCloud Mail, for Claude Code**: a checklist for the separate connector in `~/.claude/connectors/icloud-mail` (installed, registered, app-specific password in the Keychain), the Terminal command that stores the password, and **Check sign-in**, which runs the connector's own `--check` and shows what it printed. It is not part of Wagonwheel; this is only where you can see whether it is ready.

How it stays safe: the panel only **reads** Claude Code's list of connectors (`mcpServers` in `~/.claude.json`) and changes it only by running `claude mcp`, never by editing that file. That file also holds other connectors' settings, so the main process reduces it to a few facts about these two (never an environment value, header or token) before anything reaches the window; an end-to-end test plants secrets in it and checks none appears. The Keychain is asked only whether the iCloud password *exists* (attributes only, no `-w` or `-g`), so it neither prompts nor reveals it. The tests set `WAGONWHEEL_DATA_DIR`, and only then does the app honour `WAGONWHEEL_CLAUDE_CONFIG`, `WAGONWHEEL_CLAUDE_BIN`, `WAGONWHEEL_ICLOUD_DIR` and `WAGONWHEEL_SECURITY_BIN`, pointing it at stand-ins, so a test run never touches your real setup. Code: `electron/connectors/service.ts`, `src/components/ConnectorsDialog.tsx`.

| Tool | What it does |
|---|---|
| `get_overview` | Today's date, overdue tasks, tasks due in the next 7 days, tasks in progress, milestones within 30 days, and counts. The place to start. |
| `list_projects`, `get_project` | Projects with progress and their connected GitHub repository; one project in full (tasks, milestones, notes). |
| `list_services` | What the workspace pays each month (Services screen): the total against last month's, and for each service its plan, type, usual fee, the month's amount (recorded, or the usual fee as an estimate, and which), the next bill date, and any bill notably higher than usual. Read-only, also in read-only mode. |
| `record_service_bill` | Records what a service charged for a month, in US dollars, from a receipt, paid invoice or statement the user has confirmed (never a failed payment or an estimate). It records the same figure twice as one, and will not replace a *different* figure already there unless `replace: true`; the answer says what was replaced. Not offered in read-only mode. A service's plan, fee and billing day are changed in the app. |
| `list_tasks`, `get_task` | Find tasks by project, inbox, status, priority, overdue, due-date range or words; one task with its subtasks and notes. |
| `create_task`, `update_task`, `complete_task` | Add a task (to a project, the inbox, or under another task); change any field, clear dates with `null`, move it (to another project, under another task with `parent`, or back out to top level with `parent: null`; its id and notes stay); tick it done or reopen it. |
| `create_project`, `update_project` | Start a project; change one, connect or disconnect its repository, archive it. |
| `create_milestone`, `update_milestone`, `add_note` | Add or complete a milestone; add a note to a project or a task. |

- **No delete tools.** Removing things is done in the app, on purpose.
- **Same rules as the app.** Every change goes through the same data layer (`electron/db/repo.ts`), so a bad date or an empty title is refused in the same words and changes nothing; each change is one transaction.
- **The open window follows.** SQLite keeps a `data_version` counter that changes only when *another* connection writes. The app checks it every second and reloads quietly when Claude Code has changed something (its own changes never trigger it). Both sides use WAL, so reading and writing at once is safe.
- **A late reply never wins.** Every snapshot the app reads carries a rising `revision` (`electron/db/revision.ts`; the count survives a restore), and the window drops any snapshot older than the one on screen (`src/lib/snapshot-order.ts`). The number counts reads, not changes: exports and the data-info call also take one the window never sees, so gaps are normal. Snapshots from the connector carry none.
- **Local.** The server talks to Claude Code over stdin and stdout and makes no network request. What Claude Code reads from it becomes part of your conversation with Claude, as with any connector, so use `--read-only` if you want it to look but not touch.
- If it says there is no workspace, open Wagonwheel once so it creates the database. The path to the app is stable across updates, so the registration survives them.

Code: `electron/mcp/` (`protocol.ts` the MCP wire protocol, `tools.ts` the tools, `server.ts` the entry point), `electron/db/external-changes.ts` (the refresh).

## Layout

```
electron/            main process
  db/                the whole data layer: schema, migrations, CRUD, backup, export
  data-service.ts    files and dialogs (the only code that touches the disk)
  github/            the GitHub scan: device sign-in, API client, the rules that turn issues/PRs/milestones/READMEs into suggestions, the encrypted token file
  services/          Services: the Vercel usage reader, the service that checks and runs it, the encrypted token file
  mcp/               the Claude Code connector: an MCP server over stdio (protocol, tools, entry point)
  connectors/        the Connectors panel's service: reads how Claude Code is set up, runs `claude mcp`, checks the iCloud connector
  ipc.ts, preload.mts, menu.ts, main.ts
shared/              the contract between main and renderer (types, API)
src/                 renderer
  lib/               dates, dashboard and calendar maths, the Services sums (services.ts), store, UI state
  components/        sidebar, calendar, dialogs, task row, glass kit
  views/             dashboard, projects, project, tasks, inbox, services, day, timeline
  styles/            index.css (the theme: every colour) and glass.css (the glass layers)
e2e/                 Playwright-driven tests of the real app, and the screenshot baseline
build/               app icon: Wagonwheel.icon is the Liquid Glass source (light + dark), compiled into the app by scripts/afterPackIcon.cjs; icon.svg / icon-dark.svg are the flat versions, and icon.svg is the source of icon.png (the fallback)
scripts/             afterPackIcon.cjs (electron-builder afterPack hook for the icon)
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
npm test                 # unit tests: SQLite layer and migrations, exports, dates, dashboard maths, colours, the GitHub scan, Services (the sums and the Vercel reader), the Claude Code connector
npm run typecheck
npm run lint
npm run test:e2e         # builds, then drives the real app (and the connector running beside it), plus the screenshot comparison tests
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
