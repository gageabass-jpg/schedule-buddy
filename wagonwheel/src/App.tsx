import { useEffect } from "react";
import { TwinOrbit } from "@nucleus/ui/ui/twin-orbit";
import type { MenuCommand } from "@shared/types";
import { DataProvider, useData } from "@/lib/store";
import { UiProvider, useUi } from "@/lib/ui-state";
import { backupDatabase, exportCsv, exportJson, restoreBackup, revealDataFolder } from "@/lib/tools";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar } from "@/components/Sidebar";
import { ToastHost } from "@/components/ToastHost";
import { Dialogs } from "@/components/dialogs";
import { GlassButton } from "@/components/GlassButton";
import { Dashboard } from "@/views/Dashboard";
import { Projects } from "@/views/Projects";
import { ProjectDetail } from "@/views/ProjectDetail";
import { Tasks } from "@/views/Tasks";
import { Inbox } from "@/views/Inbox";
import { Services } from "@/views/Services";
import { DayView } from "@/views/DayView";
import { TimelineView } from "@/views/TimelineView";

export function App() {
  return (
    <DataProvider>
      <UiProvider>
        <Shell />
      </UiProvider>
    </DataProvider>
  );
}

/** The window: the title strip, then a floating sidebar and one large pane, over the glass ground. */
function Shell() {
  useMenuCommands();
  useExternalChanges();
  return (
    <div className="relative flex h-full flex-col">
      <div className="ww-backdrop" />
      <TitleBar />
      <div className="relative z-[1] flex min-h-0 flex-1 gap-2.5 px-3 pb-3 pt-2.5">
        <Sidebar />
        <main className="glass-panel flex min-w-0 flex-1 flex-col overflow-hidden" style={{ ["--ww-r" as string]: "18px" }}>
          <Main />
        </main>
      </div>
      <Dialogs />
      <ToastHost />
    </div>
  );
}

function Main() {
  const { status } = useData();
  const { view } = useUi();
  if (status === "loading") {
    return <div className="grid flex-1 place-items-center text-rose" role="status" aria-label="Opening your workspace"><TwinOrbit className="size-2.5" /></div>;
  }
  if (status === "error") return <DatabaseProblem />;
  switch (view.name) {
    case "dashboard": return <Dashboard />;
    case "projects": return <Projects />;
    case "project": return <ProjectDetail key={view.id} id={view.id} tab={view.tab} />;
    case "tasks": return <Tasks />;
    case "timeline": return <TimelineView />;
    case "inbox": return <Inbox />;
    case "services": return <Services />;
    case "day": return <DayView date={view.date} />;
  }
}

/** The database file would not open. Say so, say where it is, and offer a way forward that keeps the old file. */
function DatabaseProblem() {
  const { error, reload, startFresh } = useData();
  const { confirm } = useUi();
  const fresh = async () => {
    const ok = await confirm({
      title: "Start a new workspace?",
      body: "The unreadable file is not deleted: it is renamed beside the new one, so you or a repair tool can still try it. Your projects will not appear until it is restored.",
      confirmLabel: "Start new workspace",
      danger: true,
    });
    if (ok) await startFresh();
  };
  return (
    <div className="grid flex-1 place-items-center p-10">
      <div className="max-w-[520px] text-center">
        <h1 className="font-display text-[22px] font-semibold tracking-tight">Your workspace could not be opened</h1>
        <p role="alert" className="mt-3 break-words text-[14px] leading-relaxed text-ink-2">{error}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <GlassButton tone="primary" onClick={() => void reload()}>Try again</GlassButton>
          <GlassButton onClick={() => void revealDataFolder()}>Show data folder</GlassButton>
          <GlassButton tone="danger" onClick={() => void fresh()}>Start a new workspace…</GlassButton>
        </div>
      </div>
    </div>
  );
}

/** Claude Code can change the workspace through the connector while the app is open. When it does, take the
 *  new workspace quietly: a hiccup in reading it must not throw the person onto an error screen. */
function useExternalChanges() {
  const { adopt } = useData();
  useEffect(() => {
    const api = window.wagonwheel;
    if (!api) return;
    return api.onExternalChange(() => { void api.getSnapshot().then(adopt).catch(() => undefined); });
  }, [adopt]);
}

/** Menu items (File, View) arrive from the main process as commands. */
function useMenuCommands() {
  const ui = useUi();
  const { adopt } = useData();
  useEffect(() => {
    const api = window.wagonwheel;
    if (!api) return;
    return api.onCommand((cmd: MenuCommand) => {
      switch (cmd) {
        case "new-task": ui.newTask({ dueDate: ui.view.name === "day" ? ui.view.date : null, projectId: ui.view.name === "project" ? ui.view.id : null }); break;
        case "new-project": ui.newProject(); break;
        case "go-dashboard": ui.go({ name: "dashboard" }); break;
        case "go-projects": ui.go({ name: "projects" }); break;
        case "go-tasks": ui.go({ name: "tasks" }); break;
        case "go-timeline": ui.go({ name: "timeline" }); break;
        case "go-inbox": ui.go({ name: "inbox" }); break;
        case "go-services": ui.go({ name: "services" }); break;
        case "scan-github": ui.openGithub(); break;
        case "open-connectors": ui.openConnectors(); break;
        case "focus-capture": ui.focusCapture(); break;
        case "backup": void backupDatabase(); break;
        case "export-json": void exportJson(); break;
        case "export-csv": void exportCsv(); break;
        case "restore": void restoreBackup().then((s) => { if (s) adopt(s); }); break;
      }
    });
  }, [ui, adopt]);
}
