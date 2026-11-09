import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// The built app keeps every request on this machine. The dev server needs inline
// scripts for hot reload, so the policy is added to the build only.
const offlineOnly = (): Plugin => ({
  name: "wagonwheel-offline-csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace(
      "<!--CSP-->",
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'">`,
    ),
});

export default defineConfig({
  plugins: [react(), tailwindcss(), offlineOnly()],
  base: "./",
  resolve: {
    alias: {
      "@": at("./src"),
      "@shared": at("./shared"),
      // Primitives shared with Nucleus Manager live in ../shared-ui.
      "@nucleus/ui": at("../shared-ui/src"),
    },
    // ../shared-ui has no node_modules. Resolve its dependencies from this app,
    // so there is one copy of React (and of the rest).
    dedupe: [
      "react", "react-dom", "radix-ui", "@radix-ui/react-slot", "@radix-ui/react-tooltip",
      "motion", "lucide-react", "class-variance-authority", "clsx", "tailwind-merge",
    ],
  },
  server: { port: 5273, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "electron/**/*.test.ts", "shared/**/*.test.ts"],
  },
});
