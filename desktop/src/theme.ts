/** Accent for the today highlight + light-bulb. Nucleus Teal (was iOS orange).
 *  The name is kept so call sites do not churn.
 *  (The wordmark itself uses the Nucleus tokens in components/BrandMark.tsx.) */
export const MANAGER_ORANGE = "#0F6E64";

/** Wordmark font token. Defined in components/BrandMark.tsx; re-exported here so
 *  call sites can pull it from the theme alongside the other tokens. */
export { BRAND_FONT } from "./components/BrandMark";

export type PaletteName = "nucleus" | "modern" | "warm" | "garden" | "mono";

export interface Palette {
  label: string;
  G: string;
  K: string;
  BOTH: string;
  OFF: string;
}

export interface ThemeTokens {
  bg: string;
  bgElev: string;
  bgElev2: string;
  sep: string;
  text: string;
  text2: string;
  text3: string;
  scrim: string;
  cardShadow: string;
  tintAlpha: number;
  chipText: string;
  /** Which ground this is. Read this, never t.bg, to pick native control
   *  schemes: dark mode's page is no longer pure black. */
  scheme: "light" | "dark";
  /** Quiet fills behind a Teal / Clay thing (selected rows, soft buttons,
   *  warning badges). Light: the brand tints. Dark: translucent washes. */
  tealTint: string;
  clayTint: string;
  /** Teal / Clay as TEXT or a thin line on this ground. On dark these are the
   *  "Light" variants: Teal itself is 2.7:1 on Ink and fails. Filled buttons
   *  keep Teal with white text in both modes. */
  tealText: string;
  clayText: string;
}

export type DayKind = "g" | "k" | "both" | "off";

export const PALETTES: Record<PaletteName, Palette> = {
  // Nucleus brand: a person owns a hue. Gage Teal, Kaylene Clay, "both /
  // household" Ink, and free/off Teal-Mid. White chip text passes on all.
  nucleus: { label: "Nucleus", G: "#0F6E64", K: "#8A4B38", BOTH: "#14201E", OFF: "#56B7A9" },
  modern: { label: "Modern", G: "#0A84FF", K: "#FF375F", BOTH: "#BF5AF2", OFF: "#34C759" },
  warm:   { label: "Warm",   G: "#FF9F0A", K: "#FF453A", BOTH: "#FF6482", OFF: "#A2845E" },
  garden: { label: "Garden", G: "#30D158", K: "#BF5AF2", BOTH: "#5E5CE6", OFF: "#8E8E93" },
  mono:   { label: "Mono",   G: "#7D7D86", K: "#48484A", BOTH: "#1C1C1E", OFF: "#3A3A3C" },
};

export function getPalette(name: PaletteName): Palette {
  return PALETTES[name] ?? PALETTES.modern;
}

export function themeTokens(dark: boolean): ThemeTokens {
  return dark
    ? {
        // Nucleus Ink UI: the brand's dark ground, not system greys. Page a
        // shade deeper than Ink, cards on Ink, tracks a step up. Text is warm
        // Paper-white; every text colour clears 4.5:1 on every surface
        // (text3 is 4.9:1 on the track, 5.5:1 on a card).
        bg: "#0E1715",          // page
        bgElev: "#15201E",      // Ink — cards, panels
        bgElev2: "#1D2A27",     // track, quiet fills
        sep: "#2A3733",         // hairlines
        text: "#F1F0EC",
        text2: "#A9B3B0",       // Grey
        text3: "#8A9693",
        scrim: "rgba(241,240,236,0.05)",
        cardShadow: "none",
        tintAlpha: 0.22,
        chipText: "#fff",
        scheme: "dark",
        tealTint: "rgba(86,183,169,0.16)",
        clayTint: "rgba(215,143,119,0.16)",
        tealText: "#56B7A9",    // Teal Light, 7.0:1 on Ink
        clayText: "#D78F77",    // Clay Light, 6.4:1 on Ink
      }
    : {
        // Nucleus Paper UI.
        bg: "#F7F6F3",          // Paper
        bgElev: "#FFFFFF",      // Surface
        bgElev2: "#EFEDE7",     // Track
        sep: "#E2E0DA",         // Line — 1px hairlines
        text: "#14201E",        // Ink
        text2: "#5A6663",       // Ink-Muted
        text3: "#6E6B64",       // Ink-Dim
        scrim: "rgba(20,32,30,0.05)",
        // Hairlines, not shadows: cards carry a 1px Line border, so elevation
        // shadow is dropped in light (modals declare their own float shadow).
        cardShadow: "none",
        tintAlpha: 0.14,
        chipText: "#fff",
        scheme: "light",
        tealTint: "#D8E7E4",
        clayTint: "#EFDFDB",
        tealText: "#0F6E64",
        clayText: "#8A4B38",
      };
}

export function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = parseInt(x, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function dayColors(kind: DayKind, palette: Palette, dark: boolean) {
  const tintA = dark ? 0.20 : 0.13;
  const map: Record<DayKind, { tint: string; accent: string }> = {
    g:    { tint: rgba(palette.G, tintA),         accent: palette.G },
    k:    { tint: rgba(palette.K, tintA),         accent: palette.K },
    both: { tint: rgba(palette.BOTH, tintA + 0.05), accent: palette.BOTH },
    off:  { tint: "transparent",                  accent: dark ? "#3A4845" : "#C7C7CC" },
  };
  return map[kind] ?? map.off;
}

/** Daisy (supporting caregiver) — Ink-Muted in the Nucleus palette, distinct
 *  from Gage (Teal) and Kaylene (Clay). */
export const DAISY_COLOR = "#5A6663";

export function personColor(who: "G" | "K" | "D", palette: Palette): string {
  if (who === "K") return palette.K;
  if (who === "D") return DAISY_COLOR;
  return palette.G;
}

/** Color for an Event chip's tint + icon. "family" uses the BOTH (purple) accent;
 *  "Daisy" gets a green tint distinct from anyone else. */
export function eventColor(
  who: "G" | "K" | "Daisy" | "family",
  palette: Palette,
): string {
  switch (who) {
    case "G": return palette.G;
    case "K": return palette.K;
    case "Daisy": return DAISY_COLOR;   // Ink-Muted
    case "family": return palette.BOTH;
  }
}

/**
 * Colors for "Life" items. In Nucleus a person owns ONE hue, so a life item
 * takes the same colour as that person's shifts (disambiguated by shape/icon,
 * not colour): Gage Teal, Kaylene Clay, Daisy Ink-Muted, family Ink.
 */
export function lifeColor(who: "G" | "K" | "Daisy" | "family"): string {
  switch (who) {
    case "G":      return "#0F6E64";  // Teal
    case "K":      return "#8A4B38";  // Clay
    case "Daisy":  return "#5A6663";  // Ink-Muted
    case "family": return "#14201E";  // Ink
  }
}
