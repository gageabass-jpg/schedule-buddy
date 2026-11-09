import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

/**
 * Lint rules for Nucleus Wagonwheel. The same conventions as Nucleus Manager (an unused
 * name is an error, `any` is an error, hook dependencies are checked), kept in this app's
 * own file so changing one app's rules never changes the other's.
 *
 * Wagonwheel imports shared primitives from ../shared-ui but is not allowed to change them.
 * An import path that reaches into the protected folders' internals is refused: use the
 * @nucleus/ui alias, which is the library's public door.
 */
export default tseslint.config(
  { ignores: ["dist", "dist-electron", "release", "node_modules", "e2e/artifacts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "error",
      // Set state in an effect is how a dialog resets when it opens; left as a warning, as in Nucleus Manager.
      "react-hooks/set-state-in-effect": "warn",
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["**/shared-ui/src/*", "**/shared-ui/src/**"], message: "Import the shared library as @nucleus/ui/…, not by its file path." },
          { group: ["**/desktop/*", "**/desktop/**"], message: "Wagonwheel must never import from desktop/ (Nucleus Manager)." },
        ],
      }],
    },
  },
);
