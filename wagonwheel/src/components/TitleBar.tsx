/**
 * The 28px strip across the top, carrying the wordmark. It is the window's drag handle.
 * On a Mac the traffic lights sit inset at its left (see main.ts); the strip runs
 * rose-crimson at that end, so they keep their own colours against it, then settles
 * through crimson to deep burgundy.
 */
export function TitleBar() {
  return (
    <div
      className="ww-drag relative z-10 flex h-7 shrink-0 items-center justify-center"
      style={{
        background: "linear-gradient(90deg, #e4607a 0%, #c62845 40%, #8f1834 76%, #5a1126 100%)",
        borderBottom: "1px solid rgba(0,0,0,0.42)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)",
      }}
    >
      {/* The wordmark is lowercase Sora: "nucleus" 600, the product name 400 and softer.
          pointer-events stay off so the whole strip drags the window. */}
      <span className="pointer-events-none select-none font-display text-[12.5px] leading-none tracking-[-0.02em] text-white">
        <span className="font-semibold">nucleus</span>
        <span className="font-normal text-white/70"> wagonwheel</span>
      </span>
    </div>
  );
}
