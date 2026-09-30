import { personColor, rgba, type Palette } from "../theme";
import type { Who } from "../data";
import { useHouseholdLook } from "../lib/householdLook";

interface Props {
  who: Who;
  size?: number;
  palette: Palette;
  dark?: boolean;
  ring?: boolean;
}

const PHOTOS: Record<Who, string> = {
  G: "assets/gage.jpg",
  K: "assets/kaylene.jpeg",
  D: "assets/daisy.jpeg",
};

export function PhotoAv({ who, size = 22, palette, dark = true, ring = false }: Props) {
  const color = personColor(who, palette);
  const src = PHOTOS[who];
  const look = useHouseholdLook();
  // The bundled photos are one family's; anyone else gets their initial.
  if (!look.familyPhotos) {
    const initial = look.names[who].trim().charAt(0).toUpperCase() || "?";
    return (
      <div
        aria-hidden="true"
        style={{
          width: size, height: size, borderRadius: "50%", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: color, color: "#FFFFFF", fontSize: Math.round(size * 0.46), fontWeight: 700, lineHeight: 1,
          boxShadow: ring ? `0 0 0 1.5px ${dark ? "#15201E" : "#fff"}, 0 0 0 2.5px ${color}` : undefined,
        }}
      >
        {initial}
      </div>
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        boxShadow: ring
          ? `0 0 0 1.5px ${dark ? "#15201E" : "#fff"}, 0 0 0 2.5px ${color}`
          : `0 0 0 1px ${rgba(color, 0.5)}`,
      }}
    >
      <img
        src={src}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
  );
}
