# shared-ui

UI primitives and pure helpers shared by **Nucleus Manager** (`desktop/`) and **Nucleus Wagonwheel** (`wagonwheel/`).

Source only. There is no build step and no `node_modules` here. Each app compiles these files with its own toolchain.

## What is here

| Path | What |
|---|---|
| `src/ui/` | shadcn / 21st.dev primitives: button, badge, input, tabs, popover, tooltip, scroll-area, shiny-button, timeline, and the animated icons |
| `src/lib/utils.ts` | `cn()` |
| `src/lib/modalMotion.tsx`, `popoverPos.ts`, `toast.ts` | modal/popover motion, anchored-popover maths, toast emitter |
| `src/lib/timelineAxis.ts` | timeline geometry: zoom, pan, level of detail, month ticks, row packing |
| `src/brand/nucleusMark.tsx` | the Nucleus block-knot mark (the app picks the colour) |

Colours never live here. The primitives read shadcn CSS variables (`--primary`, `--border`, …), so each app themes them in its own CSS: Teal in Manager, red glass in Wagonwheel.

## How an app uses it

1. Alias `@nucleus/ui` to `../shared-ui/src` (Vite and `tsconfig.json`).
2. Add `resolve.dedupe` for the packages in `package.json` → `peerDependencies`, so there is one copy of React.
3. Add explicit `tsconfig` `paths` for those packages (this folder has no `node_modules`). Do not use a catch-all `*` rule: it changes how every other import resolves.
4. Add `@source "../../shared-ui/src";` to the app's Tailwind CSS, so Tailwind reads these files.

`desktop/` keeps one-line re-export files at the old `components/ui/*` and `lib/*` paths, so none of its imports changed.

## Rules for changing this folder

A change here reaches both apps. Before you merge one:

- Run `npm run lint`, `npx tsc -p tsconfig.json --noEmit` and `npm test` in **both** `desktop/` and `wagonwheel/`.
- Build both. For Manager, compare the built CSS with `main`. It must not change.
- Do not add app state, Firebase or household code here.
