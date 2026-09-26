// Pixel button, from Nextjsshop's Button01 (listed on 21st.dev as
// "nextjsshop-button"). The component was supplied without its stylesheet, so
// the .button01 styles in src/index.css are our own, written for this markup.
// Changes from the supplied component:
//  - takes href / children / label instead of a hard-coded "Nextjsshop" link;
//  - an outside href opens in the browser (Electron routes target=_blank to
//    shell.openExternal);
//  - the pixels' random delays are picked once, not on every render, so the
//    pattern doesn't reshuffle when a parent re-renders.

import React, { useMemo } from "react";

interface Button01Props {
  /** Where the button goes. Without one it renders as a plain mark. */
  href?: string;
  /** What the screen reader says, e.g. "Piper Locke website". */
  label: string;
  children: React.ReactNode;
  className?: string;
}

export const Button01 = ({ href, label, children, className }: Button01Props) => {
  const pixels = useMemo(() => Array.from({ length: 25 }, () => Math.floor(Math.random() * 4)), []);
  const overlay = useMemo(() => Array.from({ length: 11 }, () => 4 + Math.floor(Math.random() * 4)), []);
  const external = !!href && /^https?:/.test(href);

  return (
    <a
      href={href}
      className={`button01${className ? ` ${className}` : ""}`}
      aria-label={label}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <span className="button01_bg" aria-hidden="true">
        <span className="button01_bg-mid"></span>
        <span className="button01_bg-right">
          {pixels.map((index, i) => (
            <span
              key={`pixel-${i}`}
              style={{ "--index": index } as React.CSSProperties}
              className="button01_bg-pixel"
            ></span>
          ))}
        </span>
        <span className="button01_bg-right-overlay">
          {overlay.map((index, i) => (
            <span
              key={`overlay-${i}`}
              style={{ "--index": index } as React.CSSProperties}
              className="button01_bg-pixel"
            ></span>
          ))}
        </span>
      </span>
      <span className="button01_inner">
        <span className="button01_text">{children}</span>
      </span>
    </a>
  );
};
