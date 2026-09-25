import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

/**
 * Lint rules for the Mac manager.
 *
 * The point of having this at all is the two classes of bug tsc cannot see:
 * React hook dependency mistakes, and code that is no longer reachable. Both
 * have bitten this codebase — a stale closure reads yesterday's state, and
 * dead helpers linger after a component is reworked.
 *
 * Style is deliberately not enforced. This codebase is written by several
 * hands and a formatter fight would produce noise, not value.
 */
export default tseslint.config(
  { ignores: ["dist", "release", "node_modules", "electron/**/*.js"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // Unused code is the thing we actually want caught. Anything
      // deliberately unused is named with a leading underscore.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],

      // These two are new in the React hooks plugin and both fire widely here:
      // the codebase resets state in an effect when a modal opens, which is
      // deliberate. Left as warnings rather than silenced, so a genuinely bad
      // new one is still visible, but they don't fail the lint until someone
      // takes on that refactor.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",

      // Casting through unknown is how this codebase reads fields that live
      // on the Firestore document but not on the typed interface. Allowed,
      // but an outright `any` still isn't.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
