// Colour by meaning: the classes a chip, or anything dressed like one, takes for each tone.

export type Tone = "neutral" | "crimson" | "ok" | "warn" | "danger" | "muted";

export const TONES: Record<Tone, string> = {
  neutral: "bg-white/[0.07] text-ink-2 border-white/10",
  // Set aside: dimmer than neutral, for what was given up on (Discontinued).
  muted: "bg-white/[0.03] text-ink-3 border-white/[0.08]",
  crimson: "bg-crimson/20 text-[#f4b1be] border-[rgba(217,139,155,0.28)]",
  ok: "bg-ok/15 text-ok border-ok/25",
  warn: "bg-warn/15 text-warn border-warn/25",
  danger: "bg-danger/15 text-danger border-danger/30",
};
