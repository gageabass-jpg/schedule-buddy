import { SmartPhone02Icon } from "@/components/ui/smart-phone-02";
import type { OnCallDay } from "../state";
import { onCallLabel } from "../lib/onCall";
import type { ThemeTokens } from "../theme";

/**
 * "📱 Kaylene is on call" — a line under the day's title in the day card and
 * the day popover. It stands on its own rather than beside a shift because
 * she can be on call on a day she isn't working. A pending one (an import
 * still awaiting review) says so.
 */
export function OnCallRow({ entry, name, color, t, size = 15, fontSize = 13, margin }: {
  entry: OnCallDay; name: string; color: string; t: ThemeTokens;
  size?: number; fontSize?: number; margin?: string;
}) {
  return (
    <div
      role="img"
      aria-label={onCallLabel(name, entry)}
      style={{ display: "flex", alignItems: "center", gap: 7, margin, fontSize, fontWeight: 500, color: t.text2 }}
    >
      <span style={{ display: "flex", flexShrink: 0, color }}>
        <SmartPhone02Icon size={size} />
      </span>
      <span>{onCallLabel(name, entry)}</span>
    </div>
  );
}
