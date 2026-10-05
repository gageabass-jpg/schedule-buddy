import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Shift, ShiftMap } from "../data";
import type { Event as SbEvent, HouseholdState } from "../state";
import { DAISY_COLOR, eventColor, personColor, rgba, MANAGER_ORANGE, type Palette, type ThemeTokens } from "../theme";
import {
  MAX_PX_PER_DAY, MIN_PER_DAY, MIN_PX_PER_DAY, blockTextFor, clampPpd, coverageBlocks,
  dayAtViewportX, dayIndex, eventBlocks, fitPpd, isoFromDayIndex, lodFor, monthSpans,
  packRows, personBlocks, schoolBlocks, scrollLeftFor, shiftsForWindow, weekdayOf,
  zoomedScrollLeft, type TlBlock,
} from "../lib/timelineAxis";

/**
 * One horizontal timeline, from a single day to a month and a little past.
 *
 * Zoom is a single number (pixels per day). Pinch or ⌘-scroll zooms around the
 * cursor, the Day / Week / Month buttons animate to a preset, and the slider
 * sits between. The centre of the view is the selected day: panning moves the
 * selection once you stop, and picking a day elsewhere scrolls to it.
 */

interface Props {
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  state: HouseholdState | null;
  events: SbEvent[];
  selected: string;
  today: string;
  selfName: string;
  partnerName: string;
  onSelectDate: (iso: string) => void;
  onOpenShiftDetail?: (date: string, shift: Shift, anchor?: DOMRect) => void;
  onEditEvent: (ev: SbEvent) => void;
  /** How many days are on screen — App uses it to size the ‹ › step. */
  onSpanDays?: (days: number) => void;
}

const GUTTER = 112;             // sticky lane-label column
const HEAD_TOP = 24;
const HEAD_BOTTOM = 28;
const DAYS_BACK = 540;          // the axis runs ~18 months each side of today
const DAYS_TOTAL = DAYS_BACK * 2 + 1;
const COVERAGE_FILL = "linear-gradient(180deg, #56B7A9, #0F6E64)";
const DRAG_PX = 4;
const EASE_MS = 260;

const WEEKDAY_3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const PRESETS = [
  { key: "day", label: "Day", days: 1 },
  { key: "week", label: "Week", days: 7 },
  { key: "month", label: "Month", days: 31 },
] as const;

const hatch = (color: string) =>
  `repeating-linear-gradient(45deg, ${rgba(color, 0.55)} 0, ${rgba(color, 0.55)} 2px, ${rgba(color, 0.12)} 2px, ${rgba(color, 0.12)} 6px)`;

const hourLabel = (h: number): string => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;

const reducedMotion = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function TimelineView({
  palette, t, dark, state, events, selected, today, selfName, partnerName,
  onSelectDate, onOpenShiftDetail, onEditEvent, onSpanDays,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const origin = useMemo(() => dayIndex(today) - DAYS_BACK, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [vw, setVw] = useState(1100);
  const [ppd, setPpd] = useState(() => fitPpd(7, 1100 - GUTTER));
  const [scrollLeft, setScrollLeft] = useState(0);
  const [now, setNow] = useState(() => new Date());

  // Mirrors of the numbers above that event handlers need synchronously — a
  // fast wheel burst fires several events before React re-renders.
  const ppdRef = useRef(ppd);
  const scrollRef = useRef(0);
  const vwRef = useRef(vw);
  const pendingScroll = useRef<number | null>(null);
  const tween = useRef<number | null>(null);
  const settle = useRef<number | null>(null);
  const emitted = useRef<string | null>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const centerVx = useCallback(() => GUTTER + (vwRef.current - GUTTER) / 2, []);
  const centerDay = useCallback(
    () => dayAtViewportX(scrollRef.current, centerVx(), GUTTER, ppdRef.current),
    [centerVx],
  );

  // ── View control ──────────────────────────────────────────────────────────

  /** Set zoom and scroll together; the scroll lands after the new width does. */
  const applyView = useCallback((nextPpd: number, nextScroll: number) => {
    ppdRef.current = nextPpd;
    scrollRef.current = Math.max(0, nextScroll);
    pendingScroll.current = scrollRef.current;
    setPpd(nextPpd);
    // Same zoom ⇒ no re-render ⇒ no layout effect. Scroll directly.
    const el = scrollerRef.current;
    if (el && nextPpd === ppd) { el.scrollLeft = scrollRef.current; pendingScroll.current = null; }
  }, [ppd]);

  const cancelTween = useCallback(() => {
    if (tween.current !== null) { cancelAnimationFrame(tween.current); tween.current = null; }
  }, []);

  const zoomTo = useCallback((target: number, vx: number) => {
    const next = clampPpd(target);
    const old = ppdRef.current;
    if (next === old) return;
    applyView(next, zoomedScrollLeft(scrollRef.current, vx, GUTTER, old, next));
  }, [applyView]);

  /** Animate zoom and centre together. Zoom runs in log space so each frame
   *  feels like the same amount of zoom. */
  const glideTo = useCallback((targetPpd: number, targetCenter: number) => {
    cancelTween();
    const p1 = clampPpd(targetPpd);
    const c0 = centerDay();
    const p0 = ppdRef.current;
    const place = (p: number, c: number) =>
      applyView(p, scrollLeftFor(c, centerVx(), GUTTER, p));
    if (reducedMotion() || (Math.abs(p1 - p0) < 0.5 && Math.abs(targetCenter - c0) < 1e-3)) {
      place(p1, targetCenter);
      return;
    }
    const t0 = performance.now();
    const step = (tNow: number) => {
      const k = Math.min(1, (tNow - t0) / EASE_MS);
      const e = 1 - Math.pow(1 - k, 3);
      place(Math.exp(Math.log(p0) + (Math.log(p1) - Math.log(p0)) * e), c0 + (targetCenter - c0) * e);
      tween.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    tween.current = requestAnimationFrame(step);
  }, [applyView, cancelTween, centerDay, centerVx]);

  const selectedCenter = () => dayIndex(selectedRef.current) - origin + 0.5;

  const goPreset = (days: number) => glideTo(fitPpd(days, vwRef.current - GUTTER), selectedCenter());
  const zoomDayAt = (iso: string) => {
    emitted.current = iso;
    onSelectDate(iso);
    glideTo(fitPpd(1, vwRef.current - GUTTER), dayIndex(iso) - origin + 0.5);
  };

  // Land the scroll after a zoom has widened (or narrowed) the track.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && pendingScroll.current !== null) {
      el.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
    }
  }, [ppd]);

  // First paint: measure, fit a week, and centre the selected day.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    vwRef.current = w;
    setVw(w);
    const p = fitPpd(7, w - GUTTER);
    applyView(p, scrollLeftFor(selectedCenter(), GUTTER + (w - GUTTER) / 2, GUTTER, p));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { vwRef.current = el.clientWidth; setVw(el.clientWidth); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => () => { cancelTween(); if (settle.current !== null) clearTimeout(settle.current); }, [cancelTween]);

  useEffect(() => { onSpanDays?.((vw - GUTTER) / ppd); }, [vw, ppd, onSpanDays]);

  // Something else picked a day (mini month, ‹ ›, Today): bring it to centre.
  useEffect(() => {
    if (selected === emitted.current) return;
    const idx = dayIndex(selected) - origin;
    if (Math.floor(centerDay()) === idx) return;
    glideTo(ppdRef.current, idx + 0.5);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scrolling: keep React's copy fresh, and once it stops, select the centre day.
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    scrollRef.current = el.scrollLeft;
    setScrollLeft(el.scrollLeft);
    if (settle.current !== null) clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const iso = isoFromDayIndex(origin + Math.floor(centerDay()));
      if (iso !== selectedRef.current) { emitted.current = iso; onSelectDate(iso); }
    }, 180);
  };

  // Wheel: ⌘/ctrl (and trackpad pinch, which Chromium sends as ctrl+wheel)
  // zooms around the cursor; a plain mouse wheel pans sideways.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        cancelTween();
        const vx = Math.max(GUTTER, e.clientX - el.getBoundingClientRect().left);
        zoomTo(ppdRef.current * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.003)), vx);
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        cancelTween();
        el.scrollLeft += e.deltaY;
      } else {
        cancelTween();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo, cancelTween]);

  // Drag to pan. Capture only once the pointer really moves, so a plain click
  // still reaches the block or day under it.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    cancelTween();
    drag.current = { x: e.clientX, left: scrollerRef.current?.scrollLeft ?? 0, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = scrollerRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > DRAG_PX) {
      d.moved = true;
      el.setPointerCapture(e.pointerId);
    }
    if (d.moved) el.scrollLeft = d.left - dx;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const el = scrollerRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    // Leave `moved` set until the click that follows has been ignored.
    window.setTimeout(() => { drag.current = null; }, 0);
  };
  /** True for the click that ends a drag — it must not select or open anything. */
  const wasDrag = useCallback(() => !!drag.current?.moved, []);
  const clickDay = useCallback((iso: string) => {
    if (wasDrag()) return;
    emitted.current = iso;
    onSelectDate(iso);
  }, [wasDrag, onSelectDate]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = scrollerRef.current;
    if (!el) return;
    if (e.key === "+" || e.key === "=") { cancelTween(); zoomTo(ppdRef.current * 1.5, centerVx()); }
    else if (e.key === "-" || e.key === "_") { cancelTween(); zoomTo(ppdRef.current / 1.5, centerVx()); }
    else if (e.key === "ArrowLeft") { cancelTween(); el.scrollBy({ left: -(vw - GUTTER) / 4, behavior: "smooth" }); }
    else if (e.key === "ArrowRight") { cancelTween(); el.scrollBy({ left: (vw - GUTTER) / 4, behavior: "smooth" }); }
    else return;
    e.preventDefault();
  };

  // ── What is on screen ─────────────────────────────────────────────────────

  const lod = lodFor(ppd);
  const trackPx = Math.max(0, vw - GUTTER);
  const lastIdx = DAYS_TOTAL - 1;
  const visFrom = Math.max(0, Math.floor(scrollLeft / ppd) - 1);
  const visTo = Math.min(lastIdx, Math.ceil((scrollLeft + trackPx) / ppd) + 1);
  // Built in two-week buckets so panning a few pixels does not rebuild shifts.
  const bFrom = Math.floor((origin + visFrom) / 14) * 14 - 14;
  const bTo = Math.ceil((origin + visTo) / 14) * 14 + 14;

  const data = useMemo(() => {
    if (!state) return null;
    const shifts: ShiftMap = shiftsForWindow(state, bFrom, bTo);
    const hasDaisy = !!state.dependents?.daisy;
    return {
      shifts,
      G: personBlocks(state, shifts, "G", bFrom, bTo),
      K: personBlocks(state, shifts, "K", bFrom, bTo),
      D: hasDaisy ? [...schoolBlocks(state, bFrom, bTo), ...personBlocks(state, shifts, "D", bFrom, bTo)] : null,
      cov: coverageBlocks(state, bFrom, bTo),
      ev: eventBlocks(events, bFrom, bTo),
    };
  }, [state, events, bFrom, bTo]);

  const evPack = useMemo(() => packRows(data?.ev ?? [], 45), [data]);

  const todayIdx = dayIndex(today) - origin;
  const selIdx = dayIndex(selected) - origin;
  const days: number[] = [];
  for (let i = visFrom; i <= visTo; i++) days.push(i);

  const totalW = DAYS_TOTAL * ppd;
  const visLeftMin = (origin + (scrollLeft - GUTTER) / ppd) * MIN_PER_DAY;
  const visRightMin = (origin + (scrollLeft + vw - GUTTER) / ppd) * MIN_PER_DAY;
  const px = (min: number) => GUTTER + (min / MIN_PER_DAY - origin) * ppd;

  const nowMin = dayIndex(today) * MIN_PER_DAY + now.getHours() * 60 + now.getMinutes();
  const nowX = px(nowMin);

  const daisyName = state?.dependents?.daisy?.name || "Daisy";
  const lanes: { key: string; name: string; color: string; h: number }[] = [
    { key: "G", name: selfName, color: personColor("G", palette), h: 54 },
    { key: "K", name: partnerName, color: personColor("K", palette), h: 54 },
    ...(data?.D ? [{ key: "D", name: daisyName, color: DAISY_COLOR, h: 40 }] : []),
    { key: "cov", name: "Coverage", color: "#0F6E64", h: 32 },
    { key: "ev", name: "Events", color: t.text2, h: Math.max(40, evPack.count * 24 + 12) },
  ];
  const lanesH = lanes.reduce((s, l) => s + l.h, 0);

  const visible = (b: TlBlock) => b.endMin >= visLeftMin && b.startMin <= visRightMin;

  // ── Pieces ────────────────────────────────────────────────────────────────

  const renderBlock = (b: TlBlock, color: string, row?: number) => {
    const w = Math.max(2, ((b.endMin - b.startMin) / MIN_PER_DAY) * ppd);
    const text = blockTextFor(w);
    const left = px(b.startMin);
    // A block that starts off-screen keeps its text in view, not cut at the edge.
    const lead = Math.max(0, Math.min(w - 40, scrollLeft + GUTTER - left));
    const common: React.CSSProperties = {
      position: "absolute", left, width: w, boxSizing: "border-box", overflow: "hidden",
      whiteSpace: "nowrap", textOverflow: "ellipsis", borderRadius: 6, lineHeight: 1.2,
    };
    const tip = `${b.label}${b.sub ? ` · ${b.sub}` : ""}`;

    if (b.kind === "rest") {
      return <div key={b.id} title={`${b.who === "K" ? partnerName : selfName} resting · ${b.sub}`}
        style={{ ...common, top: 6, bottom: 6, background: hatch(color), opacity: 0.75, pointerEvents: "none" }} />;
    }
    if (b.kind === "school") {
      return <div key={b.id} title={`${daisyName} at school · ${b.sub}`}
        style={{ ...common, top: 6, bottom: 6, background: rgba(color, 0.28), border: `1px dashed ${rgba(color, 0.7)}`,
          padding: `0 6px 0 ${6 + lead}px`, fontSize: 10.5, color: t.text2, display: "flex", alignItems: "center" }}>
        {text !== "none" ? "School" : ""}
      </div>;
    }
    if (b.kind === "coverage") {
      return <div key={b.id} title={tip}
        style={{ ...common, top: 5, bottom: 5, background: COVERAGE_FILL, color: "#fff", opacity: b.pending ? 0.7 : 1,
          border: b.pending ? "1px dashed #fff" : undefined, padding: `0 7px 0 ${7 + lead}px`, fontSize: 11, fontWeight: 600,
          display: "flex", alignItems: "center" }}>
        {text === "full" ? `${b.label} · ${b.sub}` : text === "chip" ? "Cov" : ""}
      </div>;
    }
    if (b.kind === "event") {
      const evColor = eventColor(b.event!.who, palette);
      const top = 6 + (row ?? 0) * 24;
      return <button key={b.id} type="button" title={`${tip}${b.pending ? " (pending)" : ""}`}
        onClick={() => { if (!wasDrag() && b.event) onEditEvent(b.event); }}
        style={{ ...common, top, height: 20, border: 0, borderLeft: `3px solid ${evColor}`, borderRadius: 4,
          background: rgba(evColor, b.allDay ? 0.14 : 0.24), color: t.text, textAlign: "left",
          padding: `0 6px 0 ${6 + lead}px`, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          outline: b.pending ? `1px dashed ${evColor}` : undefined, outlineOffset: -1 }}>
        {w >= 28 ? b.label : ""}
      </button>;
    }
    // work
    const shift = data?.shifts[b.date]?.[b.shiftIndex ?? -1];
    return <button key={b.id} type="button" title={`${b.who === "K" ? partnerName : b.who === "D" ? daisyName : selfName} · ${tip}${b.pending ? " (pending)" : ""}`}
      onClick={(e) => { if (!wasDrag() && shift) onOpenShiftDetail?.(b.date, shift, e.currentTarget.getBoundingClientRect()); }}
      style={{ ...common, top: 5, bottom: 5, border: b.pending ? `1.5px dashed #fff` : 0, background: color, color: "#fff",
        opacity: b.pending ? 0.75 : 1, padding: `0 7px 0 ${7 + lead}px`, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
        display: "flex", flexDirection: "column", justifyContent: "center", fontSize: 11.5, fontWeight: 700 }}>
      {text === "full" ? (<>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{b.label}</span>
        <span style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.9 }}>{b.sub}</span>
      </>) : text === "chip" ? (b.chip ?? b.label) : null}
    </button>;
  };

  const laneBlocks = (key: string): { b: TlBlock; row?: number }[] => {
    if (!data) return [];
    const list =
      key === "G" ? data.G : key === "K" ? data.K : key === "D" ? data.D ?? [] : key === "cov" ? data.cov : data.ev;
    // Rest first so solid blocks draw over it.
    const ordered = key === "ev" ? list : [...list].sort((a, b) => (a.kind === "rest" ? 0 : 1) - (b.kind === "rest" ? 0 : 1));
    return ordered.filter(visible).map((b) => ({ b, row: key === "ev" ? evPack.rows.get(b.id) : undefined }));
  };

  const laneLabel = (name: string, color: string, key: string) => (
    <div style={{
      position: "sticky", left: 0, width: GUTTER, height: "100%", boxSizing: "border-box", zIndex: 4,
      background: t.bg, borderRight: `1px solid ${t.sep}`, display: "flex", alignItems: "center", gap: 8, padding: "0 10px",
    }}>
      <span style={{ width: 10, height: 10, borderRadius: key === "ev" ? 5 : 3, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: t.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
    </div>
  );

  const dayHeadCell = (i: number) => {
    const idx = origin + i;
    const date = new Date(idx * 86_400_000);
    const dow = weekdayOf(idx);
    const num = date.getUTCDate();
    const isSel = i === selIdx;
    const isToday = i === todayIdx;
    const text = lod.dayLabel === "weekday-number" ? `${WEEKDAY_3[dow]} ${num}` : lod.dayLabel === "number" ? String(num) : "";
    return (
      <button key={i} type="button" title={`${WEEKDAY_LONG[dow]}, ${MONTH_LONG[date.getUTCMonth()]} ${num} — double-click to zoom in`}
        onClick={() => clickDay(isoFromDayIndex(idx))}
        onDoubleClick={() => zoomDayAt(isoFromDayIndex(idx))}
        style={{ position: "absolute", left: i * ppd + GUTTER, width: ppd, top: 0, bottom: 0, boxSizing: "border-box",
          border: 0, borderLeft: `0.5px solid ${t.sep}`, background: "transparent", padding: 0, cursor: "pointer",
          fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {text && (
          <span style={{
            fontSize: 11.5, fontVariantNumeric: "tabular-nums", padding: "2px 6px", borderRadius: 10,
            fontWeight: isSel || isToday ? 700 : 500,
            background: isSel ? MANAGER_ORANGE : "transparent",
            color: isSel ? "#fff" : isToday ? MANAGER_ORANGE : dow === 0 || dow === 6 ? t.text3 : t.text2,
          }}>{text}</span>
        )}
      </button>
    );
  };

  // Gridlines sit on the labelled hours, plus dotted half-hours when very close.
  const hourLines: { h: number; dotted: boolean }[] = [];
  if (lod.hourStep) {
    for (let h = 0; h < 24; h += lod.hourStep) if (h > 0) hourLines.push({ h, dotted: false });
    if (lod.halfHour) for (let h = 0.5; h < 24; h += 1) hourLines.push({ h, dotted: true });
  }

  const inDays = lod.topIsDays;
  const months = !inDays ? monthSpans(origin + visFrom, origin + visTo) : [];
  const stickyText: React.CSSProperties = { position: "sticky", left: GUTTER + 8, display: "inline-block", whiteSpace: "nowrap" };

  const presetActive = (days: number) => {
    const p = fitPpd(days, trackPx);
    return Math.abs(Math.log(ppd / p)) < 0.08;
  };

  const btn = (active = false): React.CSSProperties => ({
    height: 26, padding: "0 11px", border: `1px solid ${active ? MANAGER_ORANGE : t.sep}`, borderRadius: 6,
    background: active ? MANAGER_ORANGE : t.bgElev, color: active ? "#fff" : t.text2, fontSize: 12, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  });

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 14, gap: 10 }}>
      {/* Zoom bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div role="group" aria-label="Zoom preset" style={{ display: "flex", gap: 4 }}>
          {PRESETS.map((p) => (
            <button key={p.key} type="button" style={btn(presetActive(p.days))} onClick={() => goPreset(p.days)}
              aria-pressed={presetActive(p.days)}>{p.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" aria-label="Zoom out" title="Zoom out (−)" style={{ ...btn(), padding: 0, width: 26 }}
            onClick={() => { cancelTween(); zoomTo(ppdRef.current / 1.5, centerVx()); }}>−</button>
          <input type="range" aria-label="Zoom" min={Math.log(MIN_PX_PER_DAY)} max={Math.log(MAX_PX_PER_DAY)} step={0.01}
            value={Math.log(ppd)} style={{ width: 150, accentColor: MANAGER_ORANGE }}
            onChange={(e) => { cancelTween(); zoomTo(Math.exp(Number(e.target.value)), centerVx()); }} />
          <button type="button" aria-label="Zoom in" title="Zoom in (+)" style={{ ...btn(), padding: 0, width: 26 }}
            onClick={() => { cancelTween(); zoomTo(ppdRef.current * 1.5, centerVx()); }}>+</button>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 11, color: t.text3 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 9, borderRadius: 3, background: palette.G }} />Working</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 9, borderRadius: 3, background: hatch(t.text2) }} />Resting</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 9, borderRadius: 3, background: COVERAGE_FILL }} />Coverage</span>
        </div>
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0, border: `1px solid ${t.sep}`, borderRadius: 10, background: t.bgElev, overflow: "hidden" }}>
        <div
          ref={scrollerRef}
          role="group"
          aria-label="Schedule timeline. Plus and minus zoom; arrow keys pan."
          tabIndex={0}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          style={{ position: "absolute", inset: 0, overflowX: "auto", overflowY: "hidden", cursor: "grab", outline: "none", touchAction: "pan-x", userSelect: "none" }}
        >
          <div style={{ position: "relative", width: GUTTER + totalW, height: "100%" }}>
            {/* Header */}
            <div style={{ position: "sticky", top: 0, zIndex: 5, height: HEAD_TOP + HEAD_BOTTOM, background: t.bg, borderBottom: `1px solid ${t.sep}` }}>
              <div style={{ position: "sticky", left: 0, width: GUTTER, height: "100%", background: t.bg, borderRight: `1px solid ${t.sep}`, zIndex: 6, boxSizing: "border-box" }} />
              {/* Top row */}
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: HEAD_TOP }}>
                {inDays
                  ? days.map((i) => {
                      const idx = origin + i;
                      const dt = new Date(idx * 86_400_000);
                      const dow = weekdayOf(idx);
                      const full = ppd >= 500;
                      const txt = full
                        ? `${WEEKDAY_LONG[dow]}, ${MONTH_LONG[dt.getUTCMonth()]} ${dt.getUTCDate()}`
                        : `${WEEKDAY_3[dow]}, ${MONTH_3[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
                      return (
                        <div key={i} style={{ position: "absolute", left: i * ppd + GUTTER, width: ppd, top: 0, bottom: 0, borderLeft: `0.5px solid ${t.sep}`, boxSizing: "border-box", display: "flex", alignItems: "center" }}>
                          <span style={{ ...stickyText, fontSize: 11, fontWeight: 700, color: i === todayIdx ? MANAGER_ORANGE : t.text2 }}>{txt}</span>
                        </div>
                      );
                    })
                  : months.map((m) => (
                      <div key={m.key} style={{ position: "absolute", left: (m.startIdx - origin) * ppd + GUTTER, width: m.days * ppd, top: 0, bottom: 0, borderLeft: `1px solid ${t.sep}`, boxSizing: "border-box", display: "flex", alignItems: "center" }}>
                        <span style={{ ...stickyText, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: t.text2 }}>{m.label}</span>
                      </div>
                    ))}
              </div>
              {/* Second row: hours when zoomed in, days when zoomed out */}
              <div style={{ position: "absolute", left: 0, right: 0, top: HEAD_TOP, height: HEAD_BOTTOM }}>
                {lod.hourStep
                  ? days.flatMap((i) =>
                      Array.from({ length: 24 / lod.hourStep }, (_, k) => {
                        const h = k * lod.hourStep;
                        return (
                          <div key={`${i}-${h}`} style={{ position: "absolute", left: GUTTER + i * ppd + (h / 24) * ppd, top: 0, bottom: 0, borderLeft: `0.5px solid ${t.sep}`, paddingLeft: 4, display: "flex", alignItems: "center", fontSize: 10.5, color: t.text3, fontVariantNumeric: "tabular-nums" }}>
                            {hourLabel(h)}
                          </div>
                        );
                      }))
                  : days.map(dayHeadCell)}
              </div>
            </div>

            {/* Lanes */}
            <div style={{ position: "relative", height: lanesH }}>
              {/* Grid */}
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, pointerEvents: "none", zIndex: 0 }}>
                {days.map((i) => {
                  const idx = origin + i;
                  const dow = weekdayOf(idx);
                  const dom = new Date(idx * 86_400_000).getUTCDate();
                  const isSel = i === selIdx;
                  const isToday = i === todayIdx;
                  const tint = !lod.hourStep;
                  const bg = tint && isSel ? rgba(MANAGER_ORANGE, dark ? 0.16 : 0.09)
                    : tint && isToday ? rgba(MANAGER_ORANGE, dark ? 0.1 : 0.05)
                    : dow === 0 || dow === 6 ? rgba(dark ? "#ffffff" : "#14201E", dark ? 0.035 : 0.03) : "transparent";
                  const edge = dom === 1 ? `1px solid ${t.text3}` : dow === 0 ? `1px solid ${t.sep}` : `0.5px solid ${rgba(dark ? "#ffffff" : "#14201E", 0.08)}`;
                  return <div key={i} style={{ position: "absolute", left: GUTTER + i * ppd, width: ppd, top: 0, bottom: 0, background: bg, borderLeft: ppd >= 28 || dom === 1 ? edge : undefined, boxSizing: "border-box" }} />;
                })}
                {days.flatMap((i) =>
                  hourLines.map(({ h, dotted }) => (
                    <div key={`${i}-${h}`} style={{ position: "absolute", left: GUTTER + i * ppd + (h / 24) * ppd, top: 0, bottom: 0, borderLeft: `0.5px ${dotted ? "dotted" : "solid"} ${rgba(dark ? "#ffffff" : "#14201E", dotted ? 0.06 : 0.1)}` }} />
                  )))}
              </div>

              {lanes.map((lane) => (
                <div key={lane.key} style={{ position: "relative", height: lane.h, borderBottom: `1px solid ${t.sep}` }}>
                  {laneLabel(lane.name, lane.color, lane.key)}
                  {laneBlocks(lane.key).map(({ b, row }) => renderBlock(b, lane.color, row))}
                </div>
              ))}

              {/* Now */}
              {nowX >= GUTTER && (
                <div style={{ position: "absolute", left: nowX - 1, top: 0, bottom: 0, width: 2, background: MANAGER_ORANGE, zIndex: 3, pointerEvents: "none" }} />
              )}
            </div>
          </div>
        </div>

        {/* Centre marker: the day the view is centred on */}
        <div aria-hidden="true" style={{ position: "absolute", top: HEAD_TOP + HEAD_BOTTOM - 1, left: GUTTER + trackPx / 2 - 5, width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: `6px solid ${MANAGER_ORANGE}`, pointerEvents: "none", zIndex: 7 }} />

        {!state && (
          <div style={{ position: "absolute", left: GUTTER, right: 0, top: HEAD_TOP + HEAD_BOTTOM, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", color: t.text3, fontSize: 13, pointerEvents: "none" }}>
            Waiting for household data…
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: t.text3 }}>
        Pinch or ⌘-scroll to zoom · drag or scroll to pan · double-click a day to open it · + / − and ← / → work too
      </div>
    </div>
  );
}
