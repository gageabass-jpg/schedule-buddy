import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ThemeTokens } from "../theme";
import { searchPlaces, type PlaceSuggestion } from "../lib/placesAutocomplete";

/**
 * The employer box in a person's editor. Typing searches Google Places
 * (through the placesAutocomplete function) and lists matching businesses;
 * picking one fills in its name. Anything typed can still be saved as is, and
 * if the search is unavailable the box simply behaves like a text field.
 */
export function EmployerField({ value, onChange, onPick, placeholder, ariaLabel, t, inputStyle }: {
  value: string;
  onChange: (v: string) => void;
  /** Called with the place itself when one is picked from the list. */
  onPick?: (place: PlaceSuggestion) => void;
  placeholder: string;
  ariaLabel: string;
  t: ThemeTokens;
  inputStyle: CSSProperties;
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Only search after the person types; a value loaded from the household
  // or just picked from the list shouldn't open the list.
  const typed = useRef(false);
  const session = useRef<string | null>(null);
  const request = useRef(0);
  const listId = `employer-list${useId()}`;

  useEffect(() => {
    if (!typed.current) return;
    const q = value.trim();
    const id = ++request.current;
    if (q.length < 2) {
      const clear = window.setTimeout(() => { setSuggestions([]); setOpen(false); }, 0);
      return () => window.clearTimeout(clear);
    }
    const timer = window.setTimeout(async () => {
      try {
        session.current ??= crypto.randomUUID();
        const found = await searchPlaces(q, session.current);
        if (id !== request.current) return;       // a newer keystroke won
        setSuggestions(found);
        setActive(-1);
        setOpen(found.length > 0);
      } catch {
        if (id === request.current) { setSuggestions([]); setOpen(false); }
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [value]);

  const pick = (s: PlaceSuggestion) => {
    typed.current = false;
    session.current = null;                       // the next search is a new session
    onChange(s.name);
    onPick?.(s);
    setOpen(false);
    setSuggestions([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % suggestions.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(suggestions[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => { typed.current = true; onChange(e.target.value); }}
        onKeyDown={onKeyDown}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        style={inputStyle}
      />
      {open && (
        <div
          style={{
            position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 20,
            background: t.bgElev, border: `1px solid ${t.sep}`, borderRadius: 6,
            boxShadow: "0 10px 28px rgba(20,32,30,0.16)", overflow: "hidden",
          }}
        >
          <div id={listId} role="listbox" aria-label="Matching places">
            {suggestions.map((s, i) => (
              <div
                key={s.placeId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                onMouseEnter={() => setActive(i)}
                style={{
                  padding: "8px 12px", cursor: "pointer",
                  background: i === active ? t.tealTint : "transparent",
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>{s.name}</div>
                {s.detail && <div style={{ fontSize: 12, color: t.text2, marginTop: 1 }}>{s.detail}</div>}
              </div>
            ))}
          </div>
          {/* Google requires attribution when Places results show without a map. */}
          <div style={{ padding: "5px 12px 6px", borderTop: `1px solid ${t.sep}`, fontSize: 10.5, color: t.text3, textAlign: "right" }}>
            Powered by Google
          </div>
        </div>
      )}
    </div>
  );
}
