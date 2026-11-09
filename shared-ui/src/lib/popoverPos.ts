/**
 * Shared anchored-popover geometry.
 *
 * Both the shift-detail and day-detail popovers open beside the element that
 * was clicked, with a tail pointing back at it. They flip to the element's
 * left when there isn't room on the right (e.g. the Saturday column), and
 * clamp to the viewport so the card is never pushed off-screen.
 */

export interface PopoverPos {
  left: number;
  top: number;
  side: "left" | "right";
  /** Tail offset from the card's top edge, so it lines up with the anchor. */
  tailTop: number;
}

export function computePopoverPos(a: DOMRect, pw: number, ph: number): PopoverPos {
  const gap = 10, margin = 8;
  const vw = window.innerWidth, vh = window.innerHeight;
  const side: "left" | "right" = (vw - a.right) >= pw + gap + margin ? "right" : "left";
  let left = side === "right" ? a.right + gap : a.left - gap - pw;
  left = Math.max(margin, Math.min(left, vw - pw - margin));
  const tailCenterY = a.top + a.height / 2;
  const top = Math.max(margin, Math.min(tailCenterY - ph / 2, vh - ph - margin));
  const tailTop = Math.max(16, Math.min(tailCenterY - top, ph - 16));
  return { left, top, side, tailTop };
}

/** The CSS triangle that points at the anchor. */
export function tailStyleFor(pos: PopoverPos | null, color: string): React.CSSProperties {
  const style: React.CSSProperties = {
    position: "absolute",
    top: pos ? pos.tailTop - 8 : 0,
    width: 0,
    height: 0,
    borderTop: "8px solid transparent",
    borderBottom: "8px solid transparent",
  };
  if (pos) {
    if (pos.side === "right") { style.left = -7; style.borderRight = `8px solid ${color}`; }
    else { style.right = -7; style.borderLeft = `8px solid ${color}`; }
  }
  return style;
}
