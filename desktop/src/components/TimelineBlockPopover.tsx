import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MONTHS_LONG } from "../data";
import type { CoverageRequest } from "../../../shared/state";
import type { HouseholdState } from "../state";
import { BRAND_FONT, type ThemeTokens } from "../theme";
import { computePopoverPos, tailStyleFor, type PopoverPos } from "../lib/popoverPos";
import { useModalMotion } from "../lib/modalMotion";

const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const STATUS_TEXT: Record<string, string> = {
  pending: "Waiting for a reply",
  confirmed: "Confirmed",
};

const toMin = (s: string): number => { const [h, m] = (s || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const durStr = (min: number): string => { const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h ${m}m` : `${h}h`; };

interface Props {
  open: boolean;
  onClose: () => void;
  kind: "school" | "coverage";
  /** "8a–3p" — the block's own time range. */
  range: string;
  /** Block length in minutes. */
  minutes: number;
  date: string;                 // YYYY-MM-DD
  /** The coverage request behind a coverage block. */
  request?: CoverageRequest;
  /** Accent for the tick beside the name: grey for school, blue for coverage. */
  accent: string;
  anchor: DOMRect;
  t: ThemeTokens;
  dark: boolean;
  state: HouseholdState | null;
  householdName: string;
  selfName: string;
  partnerName: string;
  /** Whether each parent works that day, for the "meanwhile" lines. */
  gWorks: boolean;
  kWorks: boolean;
}

/**
 * Popover for Daisy's school and coverage blocks on the timeline. Same card as
 * the shift popover — anchored beside the block with a tail — but read-only:
 * these blocks are drawn from her school schedule and the coverage requests,
 * which are edited in their own screens.
 */
export function TimelineBlockPopover({
  open, onClose, kind, range, minutes, date, request, accent, anchor, t, dark, state,
  householdName, selfName, partnerName, gWorks, kWorks,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopoverPos | null>(() => (open ? computePopoverPos(anchor, 360, 300) : null));

  useLayoutEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    if (card) setPos(computePopoverPos(anchor, card.offsetWidth, card.offsetHeight));
  }, [open, anchor]);

  const mm = useModalMotion(open, onClose);
  if (!open) return null;

  const daisyName = state?.dependents?.daisy?.name || "Daisy";
  const [y, mo, d] = date.split("-").map(Number);
  const dow = new Date(y, mo - 1, d).getDay();
  const subtitle = [`${WEEKDAYS_LONG[dow]}, ${MONTHS_LONG[mo - 1]} ${d}`, minutes > 0 ? durStr(minutes) : ""]
    .filter(Boolean).join(" · ");

  const rows: { label: string; value: string }[] = [
    { label: "TYPE", value: kind === "school" ? "School" : "Childcare coverage" },
  ];
  if (kind === "coverage" && request) {
    rows.push({ label: "STATUS", value: STATUS_TEXT[request.status] ?? request.status });
    if (request.arriveBy) {
      const [h, m] = request.arriveBy.split(":").map(Number);
      const mins = toMin(request.arriveBy);
      rows.push({ label: "ARRIVE BY", value: `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${mins < 720 ? "a" : "p"}` });
    }
    rows.push({ label: "NOTE", value: request.notes || "—" });
    if (request.caregiverNote) rows.push({ label: "REPLY", value: request.caregiverNote });
  }

  const meanwhile: { text: string; works: boolean }[] = [
    { text: gWorks ? `${selfName} works.` : `${selfName} is off.`, works: gWorks },
    { text: kWorks ? `${partnerName} works.` : `${partnerName} is off.`, works: kWorks },
  ];

  const section: CSSProperties = { padding: "16px 18px" };
  const rule: CSSProperties = { height: 1, background: t.sep };
  const width = "min(360px, calc(100vw - 32px))";
  const anchored = !!pos;
  const wrapperStyle: CSSProperties = anchored
    ? { position: "fixed", left: pos!.left, top: pos!.top, width, overflow: "visible", zIndex: 1001 }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width, overflow: "visible", zIndex: 1001 };
  const popIn: CSSProperties = {
    ...mm.popover,
    transformOrigin: pos ? `${pos.side === "right" ? "left" : "right"} ${pos.tailTop}px` : "center",
  };

  return (
    <div onClick={onClose} style={{ ...mm.backdrop, position: "fixed", inset: 0, zIndex: 1000 }}>
      <div data-motion="" style={{ ...wrapperStyle, ...popIn }} onClick={(e) => e.stopPropagation()}>
        {pos && <div aria-hidden="true" style={tailStyleFor(pos, t.bgElev)} />}
        <div
          ref={cardRef}
          role="dialog"
          aria-label={kind === "school" ? "School detail" : "Coverage detail"}
          style={{
            position: "relative", maxHeight: "calc(100vh - 32px)", overflowY: "auto",
            background: t.bgElev, border: `1px solid ${t.sep}`, borderTop: `2px solid ${accent}`, borderRadius: 4,
            boxShadow: dark ? "0 18px 48px rgba(0,0,0,0.6)" : "0 18px 48px rgba(20,32,30,0.22)",
            color: t.text,
          }}
        >
          <div style={section}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 3, height: 16, borderRadius: 2, background: accent, flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{daisyName}</span>
            </div>
            <div style={{ fontFamily: BRAND_FONT, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 10, color: t.text }}>
              {range}
            </div>
            <div style={{ fontSize: 13, color: t.text2, marginTop: 4 }}>{subtitle} · {householdName}</div>
          </div>

          <div style={rule} />

          <div style={{ ...section, display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((r) => (
              <div key={r.label} style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ width: 74, flexShrink: 0, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: t.text3 }}>{r.label}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: t.text }}>{r.value}</span>
              </div>
            ))}
          </div>

          <div style={rule} />

          <div style={section}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: t.text3 }}>PARENTS THAT DAY</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {meanwhile.map((m) => (
                <div key={m.text} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 3, alignSelf: "stretch", minHeight: 16, borderRadius: 2, background: m.works ? t.clayText : t.tealText, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: t.text2 }}>{m.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
