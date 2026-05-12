/** Brand orange used for "Manager" wordmark + today highlight. iOS systemOrange. */
export const MANAGER_ORANGE = "#FF9F0A";

export type PaletteName = "modern" | "warm" | "garden" | "mono";

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
}

export type DayKind = "g" | "k" | "both" | "off";

export const PALETTES: Record<PaletteName, Palette> = {
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
        bg: "#000",
        bgElev: "#1C1C1E",
        bgElev2: "#2C2C2E",
        sep: "rgba(84,84,88,0.6)",
        text: "#fff",
        text2: "rgba(235,235,245,0.6)",
        text3: "rgba(235,235,245,0.3)",
        scrim: "rgba(255,255,255,0.05)",
        cardShadow: "none",
        tintAlpha: 0.22,
        chipText: "#fff",
      }
    : {
        bg: "#F2F2F7",
        bgElev: "#FFFFFF",
        bgElev2: "#F2F2F7",
        sep: "rgba(60,60,67,0.18)",
        text: "#000",
        text2: "rgba(60,60,67,0.6)",
        text3: "rgba(60,60,67,0.3)",
        scrim: "rgba(0,0,0,0.04)",
        cardShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)",
        tintAlpha: 0.14,
        chipText: "#fff",
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
    off:  { tint: "transparent",                  accent: dark ? "#48484A" : "#C7C7CC" },
  };
  return map[kind] ?? map.off;
}

export function personColor(who: "G" | "K", palette: Palette): string {
  return who === "G" ? palette.G : palette.K;
}
