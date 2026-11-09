// Lint rules for shared-ui/. They are Nucleus Manager's own rules (desktop/eslint.config.js),
// reused as they are, plus a boundary rule. Run from the repo root by scripts/check-shared-ui.mjs,
// with the toolchain installed in desktop/ (npm ci there first).
import desktop from "../../desktop/eslint.config.js";

export default [
  ...desktop,
  {
    files: ["shared-ui/**/*.{ts,tsx}"],
    rules: {
      // The library must stand alone. It may not reach into an app or use an app's "@/" alias.
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@/*"], message: "shared-ui must not use an app's @/ alias. Import with a relative path." },
          { group: ["**/desktop/**", "**/wagonwheel/**"], message: "shared-ui must not import from an app." },
          { group: ["firebase", "firebase/*", "electron"], message: "shared-ui has no Firebase or Electron code." },
        ],
      }],
    },
  },
];
