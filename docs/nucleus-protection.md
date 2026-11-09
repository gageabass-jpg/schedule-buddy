# Nucleus protection

**Permanent project rules.** They exist so work on other apps cannot break Nucleus Manager.

## Who owns what

| Folder | Owner | Rule |
|---|---|---|
| `desktop/` | Nucleus Manager | Changed only by Nucleus work. |
| `shared-ui/` | Protected shared library (both apps compile it) | Changed only in its own pull request, with the checks below passing. |
| `wagonwheel/` | Nucleus Wagonwheel | **Never** changes `desktop/` or `shared-ui/`. Not components, styles, theme, config, dependencies, build config, tests, or anything else in them. |

If Wagonwheel needs something a shared component does not give, build a wrapper, an adapter or a new component **inside `wagonwheel/`**. Do not edit a shared component to suit Wagonwheel's red glass theme. Wagonwheel themes the shared primitives with its own CSS variables and `className`.

## The checks

All are in `.github/workflows/nucleus-protection.yml`. The scripts and their tests are in `scripts/` and `ci/`, outside both protected folders.

| Check | What it does | Run it yourself |
|---|---|---|
| **isolation-guard** | A pull request that changes Wagonwheel may not change `desktop/` or `shared-ui/`. | `node scripts/guard-wagonwheel-isolation.mjs --base origin/main --head HEAD` |
| **shared-ui-checks** | Types (as strict as `desktop/`), Nucleus's own ESLint rules, and import boundaries for `shared-ui/`. Warnings are capped. | `node scripts/check-shared-ui.mjs` (after `npm ci` in `desktop/`) |
| **css-regression** | When `shared-ui/` changes: builds Nucleus from `main` and from the change, and fails if the compiled CSS differs. It builds the change twice first, and stops if those two differ (a nondeterministic build is fixed, not ignored). | `node scripts/nucleus-css-regression.mjs --base origin/main` |
| **nucleus-smoke** | Launches the built Nucleus Manager under Playwright and checks the window, the preload bridge, the rendered UI, and the absence of fatal errors. | `cd ci/smoke && npm ci && xvfb-run -a node nucleus-smoke.mjs --build` |
| **protection-scripts** | Tests of the checks above, each with planted faults, so a check that cannot fail is caught. | `node --test scripts/*.test.mjs` |

## What "attributable to Wagonwheel" means

A commit that changes `desktop/` or `shared-ui/` is attributable to Wagonwheel when any of these is true:

1. the same commit changes `wagonwheel/`;
2. its message mentions Wagonwheel;
3. the pull request changes `wagonwheel/` anywhere;
4. the pull request's title, branch or labels name Wagonwheel.

A Nucleus fix with no link to Wagonwheel is not blocked by this guard. It still has to pass the other checks.

To change `shared-ui/` or `desktop/`: open a **separate pull request** that does not touch `wagonwheel/` and does not mention Wagonwheel.

## The one sanctioned exception

`.github/wagonwheel-guard.allow` lists one commit by patch-id: the one that moved the shared primitives out of `desktop/` into `shared-ui/` (`c009199`). The owner chose to keep `shared-ui/`. The guard reports it as a warning on every run.

- **Delete that entry once the commit is on `main`.**
- Do not add entries to make a check pass. Move the change to its own pull request.

## Limits (read these)

- The guard and the checks prevent **accidents**. A person who can edit the workflow or the scripts can weaken them. For more than that, turn on branch protection that requires these checks, and CODEOWNERS review on `.github/`, `scripts/` and `ci/`. That is a GitHub setting; it is not in this repo.
- The smoke test covers a cold start (the sign-in screen). It does not sign in, so it does not exercise the calendar.
- The CSS check compares compiled CSS only. It does not see a behaviour change in a shared component's logic. `shared-ui-checks`, the Nucleus unit tests and the smoke test cover what they cover.
