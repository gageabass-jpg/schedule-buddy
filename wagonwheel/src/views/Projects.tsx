import { useMemo, useState } from "react";
import { FolderKanban, Plus } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@nucleus/ui/ui/tabs";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { compareByActivity } from "@/lib/derive";
import { EmptyState, PageHeader } from "@/components/kit";
import { GlassButton } from "@/components/GlassButton";
import { ProjectCard } from "@/components/ProjectCard";

type Filter = "active" | "all" | "archived";

/** Every project, as cards. Active hides finished and archived ones; Archived is where they wait. */
export function Projects() {
  const { snapshot } = useData();
  const { newProject } = useUi();
  const [filter, setFilter] = useState<Filter>("active");

  const groups = useMemo(() => {
    const live = snapshot.projects.filter((p) => !p.archivedAt);
    return {
      active: live.filter((p) => p.status !== "completed").sort(compareByActivity),
      all: [...live].sort(compareByActivity),
      archived: snapshot.projects.filter((p) => p.archivedAt).sort(compareByActivity),
    };
  }, [snapshot.projects]);
  const shown = groups[filter];

  return (
    <>
      <PageHeader
        title="All Projects"
        subtitle={`${groups.all.length} ${groups.all.length === 1 ? "project" : "projects"}${groups.archived.length ? ` · ${groups.archived.length} archived` : ""}`}
        actions={<GlassButton tone="primary" onClick={newProject}><Plus size={15} />New project</GlassButton>}
      />
      <div className="px-8 pb-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="active">Active · {groups.active.length}</TabsTrigger>
            <TabsTrigger value="all">All · {groups.all.length}</TabsTrigger>
            <TabsTrigger value="archived">Archived · {groups.archived.length}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {shown.length === 0 ? (
          <EmptyState
            icon={<FolderKanban size={20} />}
            title={filter === "archived" ? "Nothing archived" : snapshot.projects.length === 0 ? "No projects yet" : "No active projects"}
            body={filter === "archived" ? "Archived projects wait here. They stay out of the dashboard and the calendar." : "Create one to start planning."}
            action={filter === "archived" ? undefined : <GlassButton tone="primary" onClick={newProject}><Plus size={15} />New project</GlassButton>}
          />
        ) : (
          <div className="ww-rise grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
            {shown.map((p) => <ProjectCard key={p.id} project={p} />)}
          </div>
        )}
      </div>
    </>
  );
}
