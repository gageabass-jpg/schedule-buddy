import type { Palette } from "../theme";

interface Props {
  size?: number;
  palette: Palette;
  dark?: boolean;
}

export function BrandMark({ size = 96, palette, dark = true }: Props) {
  const tab = dark ? "#fff" : "#0A0A0A";
  const dot = dark ? "#3A3A3C" : "#E5E5EA";
  const r = size * 0.18;
  return (
    <svg width={size} height={size * 0.92} viewBox="0 0 96 88" style={{ display: "block" }}>
      <rect x="20" y="2" width="6" height="14" rx="3" fill={tab} />
      <rect x="70" y="2" width="6" height="14" rx="3" fill={tab} />
      <rect x="4" y="8" width="88" height="76" rx={r * 1.2} fill={tab} />
      {[0, 1, 2, 3].map((c) =>
        [0, 1, 2].map((rIdx) => {
          const x = 20 + c * 14;
          const y = 30 + rIdx * 14;
          let fill = dot;
          if (rIdx === 1 && c === 1) fill = palette.G;
          if (rIdx === 1 && c === 2) fill = palette.K;
          return <circle key={`${c}-${rIdx}`} cx={x} cy={y} r="4.5" fill={fill} />;
        })
      )}
    </svg>
  );
}
