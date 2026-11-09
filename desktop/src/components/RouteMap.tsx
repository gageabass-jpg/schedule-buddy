import { useEffect, useMemo } from "react";
import type { CommuteResult } from "../lib/commute";
import type { ThemeTokens } from "../theme";
import { routeChips } from "../lib/routeChips";
import { shortPlaceLabel } from "../lib/placeLabel";
import { Map as MapView, MapMarker, MarkerContent, MarkerTooltip, useMap } from "./ui/mapcn-marker-tooltip";

/**
 * The drive to work on a map: the fastest route in blue, the alternatives paler
 * beside it, each with its minutes. The route lines come from checkCommutes
 * (Google Routes); the basemap is CARTO vector tiles drawn by MapLibre
 * (components/ui/mapcn-marker-tooltip), so no map key is needed. Home and the
 * workplace are markers with hover tooltips.
 */

/** The map's height when the rail has room; it gives some back (down to MIN_HEIGHT) when it doesn't. */
const HEIGHT = 200;
const MIN_HEIGHT = 130;
const ROUTE_BLUE = "#3B82F6";

type LatLng = [number, number];
type Line = { min: number; pts: LatLng[] };

/** Google's encoded polyline (precision 5) → [lat, lng][]. */
export function decodePolyline(str: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i < str.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

/** [west, south], [east, north] around every route, in MapLibre's [lng, lat] order. */
function boundsOf(lines: Line[]): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const l of lines) {
    for (const [la, ln] of l.pts) {
      w = Math.min(w, ln); e = Math.max(e, ln);
      s = Math.min(s, la); n = Math.max(n, la);
    }
  }
  return [[w, s], [e, n]];
}

// Extra room on top for the minute chips that sit above the route.
const FIT = { padding: { top: 42, bottom: 28, left: 36, right: 36 }, maxZoom: 15, duration: 0 };

/**
 * Draws the routes as line layers and frames them. A theme change replaces the
 * map's style (and with it our layers), so everything is re-added whenever the
 * map reports itself loaded again.
 */
function RouteLayer({ lines }: { lines: Line[] }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;
    const added: Array<{ source: string; layers: string[] }> = [];
    const layout = { "line-cap": "round", "line-join": "round" } as const;
    // Alternatives first, so the fastest lies on top.
    lines.map((_, idx) => idx).reverse().forEach((idx) => {
      const best = idx === 0;
      const source = `route-${idx}`;
      map.addSource(source, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: lines[idx].pts.map(([la, ln]) => [ln, la]) },
        },
      });
      map.addLayer({
        id: `${source}-casing`, type: "line", source, layout,
        paint: { "line-color": "#ffffff", "line-opacity": best ? 0.95 : 0.55, "line-width": best ? 7 : 5 },
      });
      map.addLayer({
        id: `${source}-line`, type: "line", source, layout,
        paint: { "line-color": ROUTE_BLUE, "line-opacity": best ? 1 : 0.55, "line-width": best ? 4.5 : 3 },
      });
      added.push({ source, layers: [`${source}-casing`, `${source}-line`] });
    });
    map.fitBounds(boundsOf(lines), FIT);

    // The card can be squeezed or let out again as the rail's room changes (the
    // Month card folding, a taller window); MapLibre keeps its centre and zoom
    // through a resize, so re-frame the routes once the new size settles.
    const box = map.getContainer();
    let raf = 0;
    const refit = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { map.resize(); map.fitBounds(boundsOf(lines), FIT); });
    });
    refit.observe(box);

    // MapLibre's compact attribution starts open until the map is dragged, which
    // covers the bottom of a map this small. Start it collapsed to its (i) button.
    const attribution = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
    attribution?.classList.remove("maplibregl-compact-show");
    attribution?.removeAttribute("open");

    return () => {
      refit.disconnect();
      cancelAnimationFrame(raf);
      for (const { source, layers } of added) {
        try {
          for (const id of layers) if (map.getLayer(id)) map.removeLayer(id);
          if (map.getSource(source)) map.removeSource(source);
        } catch {
          // The style was swapped out from under us; its layers are already gone.
        }
      }
    };
  }, [map, isLoaded, lines]);

  return null;
}

export function RouteMap({ result, name, color, t, dark = true }: {
  result: CommuteResult; name: string; color: string; t: ThemeTokens; dark?: boolean;
}) {
  const lines = useMemo<Line[]>(
    () => (result.routes ?? []).map((r) => ({ min: r.durationMin, pts: decodePolyline(r.polyline) })).filter((r) => r.pts.length > 1),
    [result.routes],
  );
  const bounds = useMemo(() => (lines.length ? boundsOf(lines) : null), [lines]);

  if (!lines.length || !bounds) return null;
  const minutes = lines[0].min;
  const start = lines[0].pts[0];
  const end = lines[0].pts[lines[0].pts.length - 1];

  // One minutes chip per distinct time: a route that takes the same minutes as a
  // faster one is still drawn, but doesn't repeat the label beside it.
  const chips = routeChips(lines.map((l) => l.min));

  // Minute labels sit at different stretches of each route so they don't pile
  // up where the routes run together.
  const LABEL_AT = [0.3, 0.55, 0.75];

  return (
    <div
      className="glass-card"
      style={{
        overflow: "hidden",
        // The Inspector is a scrolling flex column. This card is the one thing in
        // it that gives way: the map part shrinks (to MIN_HEIGHT) before the rail
        // needs a scroll bar, and the floor here keeps the header + that map whole
        // rather than letting overflow: hidden clip it to nothing.
        display: "flex", flexDirection: "column",
        flex: "0 1 auto", minHeight: 224,
      }}
    >
      {/* Header: who + where on the left (the destination wraps rather than
          clipping), the drive time on the right. The colour bar runs the full
          height of the text. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", flexShrink: 0, borderBottom: "1px solid var(--glass-line)" }}>
        <span style={{ width: 4, alignSelf: "stretch", minHeight: 16, borderRadius: 2, background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: t.text3, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {name} · Commute
          </div>
          <div style={{ marginTop: 3, fontSize: 12.5, fontWeight: 500, lineHeight: 1.3, color: t.text, overflowWrap: "anywhere" }}>
            <span style={{ color: t.text3, fontWeight: 400 }}>To </span>{shortPlaceLabel(result.placeLabel)}
          </div>
          {/* The exit to get off on along the fastest route, when the commute
              check found a numbered one. Older results and surface-street
              drives have none, and show no line. */}
          {result.exit && (
            <div style={{ marginTop: 2, fontSize: 11.5, lineHeight: 1.3, color: t.text3, overflowWrap: "anywhere" }}>
              <span style={{ color: t.text2, fontWeight: 600 }}>Take exit {result.exit.number}</span>
              {result.exit.toward ? ` · toward ${result.exit.toward}` : ""}
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0, lineHeight: 1, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          <span style={{ fontSize: 20, fontWeight: 600, color: t.text, letterSpacing: "-0.02em" }}>{minutes}</span>
          <span style={{ marginLeft: 3, fontSize: 11, fontWeight: 600, color: t.text3 }}>min</span>
        </div>
      </div>
      <div style={{ position: "relative", flex: `1 1 ${HEIGHT}px`, minHeight: MIN_HEIGHT, background: "#1B2B27", overflow: "hidden" }}>
        {/* Scroll-wheel zoom is off so scrolling the side panel over the map
            scrolls the panel; drag still pans and double-click still zooms. */}
        <MapView
          theme={dark ? "dark" : "light"}
          bounds={bounds}
          fitBoundsOptions={FIT}
          scrollZoom={false}
          dragRotate={false}
        >
          <RouteLayer lines={lines} />

          {chips.show.map((idx) => {
            const l = lines[idx];
            const [la, ln] = l.pts[Math.min(l.pts.length - 1, Math.floor(l.pts.length * LABEL_AT[idx % LABEL_AT.length]))];
            const best = idx === 0;
            return (
              <MapMarker key={`min-${idx}`} longitude={ln} latitude={la} anchor="bottom" offset={[0, -6]}>
                <MarkerContent className="cursor-default">
                  <div
                    style={{
                      padding: best ? "3px 8px" : "2px 7px", borderRadius: 8, whiteSpace: "nowrap",
                      background: best ? ROUTE_BLUE : "rgba(247,246,243,0.95)",
                      color: best ? "#fff" : "#14201E",
                      fontSize: 11, fontWeight: 600, lineHeight: 1.2, textAlign: "center",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                    }}
                  >
                    {l.min} min{best && chips.fastestLabel ? <div style={{ fontSize: 9.5, fontWeight: 600, opacity: 0.9 }}>Fastest</div> : null}
                  </div>
                </MarkerContent>
              </MapMarker>
            );
          })}

          {/* Home (where the drive starts) and the workplace (where it ends). */}
          <MapMarker longitude={start[1]} latitude={start[0]}>
            <MarkerContent className="cursor-default">
              <div className="size-3.5 rounded-full border-2 border-white shadow-md" style={{ background: ROUTE_BLUE }} />
            </MarkerContent>
            <MarkerTooltip offset={12}>Home</MarkerTooltip>
          </MapMarker>
          <MapMarker longitude={end[1]} latitude={end[0]}>
            <MarkerContent className="cursor-default">
              <div className="size-3.5 rounded-full border-2 border-white shadow-md" style={{ background: "#14201E" }} />
            </MarkerContent>
            <MarkerTooltip offset={12} className="max-w-[200px]">{result.placeLabel}</MarkerTooltip>
          </MapMarker>
        </MapView>
      </div>
    </div>
  );
}
