import { personColor, rgba, type Palette } from "../theme";
import type { Who } from "../data";

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
