// Project accents. Data colours: a project owns one hue, the way a person does in Nucleus
// Manager. Chosen to sit on dark red glass without competing with the brand crimson.
export const PROJECT_COLORS = [
  { name: "Crimson", hex: "#C62845" },
  { name: "Rose", hex: "#D98B9B" },
  { name: "Amber", hex: "#E0A458" },
  { name: "Sand", hex: "#C9B79C" },
  { name: "Sage", hex: "#7FB69E" },
  { name: "Teal", hex: "#5FB3B3" },
  { name: "Slate", hex: "#7C93C9" },
  { name: "Violet", hex: "#A58BD6" },
] as const;

export const DEFAULT_PROJECT_COLOR = "#C62845";
export const projectColor = (hex: string | null | undefined): string => hex ?? DEFAULT_PROJECT_COLOR;

/** The colour a bar is filled with: the project's own, darkened until white text on it passes contrast (4.5:1). */
export function barColor(hex: string): string {
  const lum = (r: number, g: number, b: number): number => {
    const f = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  // Contrast with white = 1.05 / (L + 0.05); 4.5:1 needs L <= 0.183.
  for (let i = 0; i < 12 && lum(r, g, b) > 0.18; i++) { r = Math.round(r * 0.88); g = Math.round(g * 0.88); b = Math.round(b * 0.88); }
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
