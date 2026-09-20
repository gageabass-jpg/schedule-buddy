# Nucleus Manager

Desktop companion to the iOS [Nucleus](../) app (formerly Schedule Buddy). Used by the household admin to edit shift types, the weekly template, partner shifts, blackouts, and OT decisions — all of which sync to the same Firestore `state/main` doc the iOS app reads from.

**Stack:** Electron 33 · Vite 6 · React 18 · TypeScript

## Status

**v1 — static UI only.** Renders Variant A (sidebar + month + inspector) from the Claude Design handoff bundle against the bundle's demo `SHIFTS` data. No Firebase wiring yet — see BRIDGE.md in the repo root for the contract.

## Develop

```bash
cd desktop
npm install
npm run dev
```

Vite runs on `localhost:5173`; Electron points at it and opens dev tools. Hot reload works for the renderer.

## Build

```bash
npm run build
```

Outputs the renderer to `dist/` and the Electron main process to `dist-electron/`. Running `npm start` after build launches the packaged renderer locally.

## Layout

```
desktop/
├── electron/main.ts            # Electron main process
├── src/
│   ├── App.tsx                 # three-column layout
│   ├── main.tsx                # React entry
│   ├── theme.ts                # palettes, theme tokens, color helpers
│   ├── data.ts                 # demo SHIFTS, calendar math
│   └── components/
│       ├── Sidebar.tsx         # brand, ⌘K, mini month, list filters
│       ├── MonthGrid.tsx       # month toolbar + grid
│       ├── Inspector.tsx       # quick-add + selected-day card + week stats
│       ├── MiniMonth.tsx
│       ├── PhotoAv.tsx
│       └── BrandMark.tsx
├── public/assets/              # gage.jpg, kaylene.jpeg (copied from ../public/assets)
├── index.html                  # Vite entry
├── vite.config.ts
├── tsconfig.json               # for the React renderer
└── tsconfig.electron.json      # for the Electron main process
```

## Next

- Sign-in via Firebase Auth (Apple / Google / Email).
- Replace demo `SHIFTS` with live `state/main` Firestore subscription.
- Wire each write surface: shift type CRUD, weekly template, alt weekends, caregiver blackouts, one-off overrides, partner shifts, OT decisions.
