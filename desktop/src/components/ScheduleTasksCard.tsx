// The sidebar's end-of-period to-do list: upload each person's next schedule,
// then reconcile any childcare gaps. A task opens the thing that does it (the
// upload for that person, or the caregiver requests), and ticks itself once the
// schedule has the data (lib/scheduleTasks.ts).

import type { ReactNode } from "react";
import { TodoList, type TodoItem } from "@/components/ui/todo-list";
import type { ScheduleTask, ScheduleTasks } from "../lib/scheduleTasks";

interface Props {
  tasks: ScheduleTasks;
  /** Open the schedule upload for Gage ("G") or Kaylene ("K"). */
  onUpload: (who: "G" | "K") => void;
  /** Open the caregiver requests for the days that need cover. */
  onReconcile: () => void;
}

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

export function ScheduleTasksCard({ tasks, onUpload, onReconcile }: Props) {
  const act = (task: ScheduleTask) => {
    if (task.id === "gaps") onReconcile();
    else onUpload(task.id === "upload-G" ? "G" : "K");
  };

  const items: TodoItem[] = tasks.items.map((task) => {
    // Done tasks are plain text; the rest are buttons that go and do them.
    const title: ReactNode = task.status === "completed" ? task.title : (
      <button
        type="button"
        onClick={() => act(task)}
        className="max-w-full cursor-pointer text-left underline-offset-2 outline-none hover:underline focus-visible:underline"
      >
        {task.title}
      </button>
    );
    return { id: task.id, title, status: task.status, detail: task.detail };
  });

  return <TodoList className="glass-card" title={`${tasks.ended ? "Was due" : "Due"} ${dayLabel(tasks.periodEnd)}`} items={items} />;
}
