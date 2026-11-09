import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { IS_MAC, IS_WINDOWS } from "./lib/platform";
import { TooltipProvider } from "@/components/ui/tooltip";

// Windows gets slim scrollbars (index.css); a Mac keeps its overlay ones.
document.documentElement.classList.toggle("platform-win", IS_WINDOWS);
// A Mac window is frosted native material the desktop shows through (electron/main.ts):
// the page must not paint over it. Not in a browser preview, which has no such window.
document.documentElement.classList.toggle("vibrant", IS_MAC && !!window.sbm);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root in index.html");

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>
);
