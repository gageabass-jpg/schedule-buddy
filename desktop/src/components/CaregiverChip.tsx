import type { ThemeTokens } from "../theme";

/**
 * "Caregiver" beside Daisy's name on her row in the day card and the day
 * popover, so the name can be her own while the role still reads.
 */
export function CaregiverChip({ t, fontSize = 11 }: { t: ThemeTokens; fontSize?: number }) {
  return (
    <span
      style={{
        flexShrink: 0, marginLeft: 8, padding: "2px 6px", borderRadius: 3,
        background: t.bgElev2, color: t.text2,
        fontSize, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap", verticalAlign: "1px",
      }}
    >
      Caregiver
    </span>
  );
}
