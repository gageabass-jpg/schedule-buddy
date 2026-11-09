import { describe, expect, it } from "vitest";
import { PROJECT_COLORS, barColor } from "./colors";

const lum = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const f = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrastWithWhite = (hex: string): number => 1.05 / (lum(hex) + 0.05);

describe("barColor", () => {
  it("makes white text readable (4.5:1) on every project colour", () => {
    for (const c of PROJECT_COLORS) expect(contrastWithWhite(barColor(c.hex)), c.name).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves a colour that already passes alone, and keeps the hue of one it darkens", () => {
    expect(barColor("#C62845")).toBe("#c62845");
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(barColor("#7FB69E").slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r);   // still a green
    expect(g).toBeGreaterThan(b * 0.9);
  });
});
