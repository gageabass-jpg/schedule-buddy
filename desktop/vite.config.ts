import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: {
    alias: {
      // "@/…" → src/…, the path shadcn / 21st.dev components import from.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Primitives shared with Nucleus Wagonwheel live in ../shared-ui.
      "@nucleus/ui": fileURLToPath(new URL("../shared-ui/src", import.meta.url)),
    },
    // shared-ui sits outside this app's node_modules tree. Resolve its
    // dependencies from here, so there is one copy of React (and of the rest).
    dedupe: [
      "react", "react-dom", "radix-ui", "@radix-ui/react-slot", "@radix-ui/react-tooltip",
      "motion", "lucide-react", "class-variance-authority", "clsx", "tailwind-merge",
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
