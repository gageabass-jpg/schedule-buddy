import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@nucleus/ui/lib/utils";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { describeMarkers, dayMarkers, markerTotal } from "@/lib/derive";
import { MONTHS, WEEKDAYS, WEEKDAYS_3, formatLong, monthGrid, parts } from "@/lib/dates";

/**
 * The sidebar's month. It tells you what is on each day and takes you there:
 *  - a tinted cell has something on it (the more, the deeper the tint);
 *  - a rose dot is a task due, a coral dot an overdue one, an amber diamond a
 *    milestone or a project deadline;
 *  - the selected day is solid crimson, today is ringed.
 */
export function MiniCalendar() {
  const { snapshot, today } = useData();
  const { selectedDate, selectDate } = useUi();
  const [shown, setShown] = useState(() => { const p = parts(selectedDate); return { y: p.y, m0: p.m0 }; });
  const markers = useMemo(() => dayMarkers(snapshot, today), [snapshot, today]);
  const cells = useMemo(() => monthGrid(shown.y, shown.m0), [shown]);

  const step = (n: number) => setShown(({ y, m0 }) => { const t = m0 + n; return { y: y + Math.floor(t / 12), m0: ((t % 12) + 12) % 12 }; });
  const pick = (iso: string) => {
    const p = parts(iso);
    setShown({ y: p.y, m0: p.m0 });   // choosing a grey day from a neighbouring month turns the page
    selectDate(iso);
  };

  return (
    <div aria-label="Calendar">
      <div className="mb-2 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => pick(today)}
          title="Go to today"
          className="rounded-md px-1 py-0.5 text-[13.5px] font-semibold tracking-[-0.01em] hover:bg-white/[0.07]"
        >
          {MONTHS[shown.m0]} {shown.y}
        </button>
        <div className="flex gap-0.5">
          <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="grid size-6 place-items-center rounded-md text-ink-2 hover:bg-white/10 hover:text-foreground"><ChevronLeft size={15} /></button>
          <button type="button" aria-label="Next month" onClick={() => step(1)} className="grid size-6 place-items-center rounded-md text-ink-2 hover:bg-white/10 hover:text-foreground"><ChevronRight size={15} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-[3px]">
        {WEEKDAYS_3.map((w, i) => (
          <div key={w} aria-hidden="true" className="pb-1 text-center text-[10.5px] font-bold tracking-wide text-ink-3">{w[0]}<span className="sr-only">{WEEKDAYS[i]}</span></div>
        ))}
        {cells.map((c) => {
          const m = markers.get(c.iso);
          const total = markerTotal(m);
          const selected = c.iso === selectedDate;
          const isToday = c.iso === today;
          const note = describeMarkers(m);
          return (
            <button
              key={c.iso}
              type="button"
              onClick={() => pick(c.iso)}
              title={note ? `${formatLong(c.iso)}: ${note}` : formatLong(c.iso)}
              aria-label={`${formatLong(c.iso)}${note ? `: ${note}` : ""}`}
              aria-pressed={selected}
              aria-current={isToday ? "date" : undefined}
              className={cn(
                "relative grid aspect-square place-items-center rounded-[9px] text-[12px] font-medium tabular-nums transition-[background-color,transform] duration-150 hover:scale-[1.06]",
                !selected && "hover:bg-white/10",
                !c.inMonth && !selected && "text-ink-3/60",
                selected && "font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_12px_rgba(198,40,69,0.4)]",
              )}
              style={{
                background: selected
                  ? "linear-gradient(180deg, #d8344f, #b31f3c)"
                  : total ? `rgba(198, 40, 69, ${0.1 + Math.min(total, 3) * 0.06})` : undefined,
                boxShadow: isToday && !selected ? "inset 0 0 0 1.5px rgba(240,114,138,0.85)" : undefined,
              }}
            >
              <span className="-mt-[2px]">{c.day}</span>
              {m && (m.due > 0 || m.milestones > 0 || m.deadlines > 0) && (
                <span className="absolute bottom-[3px] flex items-center gap-[3px]" aria-hidden="true">
                  {m.due > 0 && <i className="block size-[4px] rounded-full" style={{ background: selected ? "#fff" : m.overdue ? "#ff8e72" : "#f0728a" }} />}
                  {(m.milestones > 0 || m.deadlines > 0) && <i className="block size-[4px] rotate-45" style={{ background: selected ? "#fff" : "#e6ae5c" }} />}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
