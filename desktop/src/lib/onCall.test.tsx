import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { onCallLabel, onCallOn } from "./onCall";
import { OnCallRow } from "../components/OnCallBadge";
import type { HouseholdState } from "../state";
import type { ThemeTokens } from "../theme";

/** Only the parts of the state the lookup reads. */
const state = {
  partner: {
    name: "Kaylene",
    shifts: [],
    onCall: [{ date: "2026-10-14" }, { date: "2026-10-20", pending: true, importId: "imp_1" }],
  },
} as unknown as HouseholdState;

describe("onCallOn", () => {
  it("finds the day she is on call, shift or no shift", () => {
    expect(onCallOn(state, "2026-10-14")).toEqual({ date: "2026-10-14" });
  });

  it("returns nothing for any other day", () => {
    expect(onCallOn(state, "2026-10-15")).toBeUndefined();
  });

  it("copes with no state, and with a partner who has no on-call list", () => {
    expect(onCallOn(null, "2026-10-14")).toBeUndefined();
    expect(onCallOn({ partner: { name: "K", shifts: [] } } as unknown as HouseholdState, "2026-10-14")).toBeUndefined();
  });
});

describe("onCallLabel", () => {
  it("says who is on call, and when it is only pending", () => {
    expect(onCallLabel("Kaylene", { date: "2026-10-14" })).toBe("Kaylene is on call");
    expect(onCallLabel("Kaylene", { date: "2026-10-20", pending: true })).toBe("Kaylene is on call (pending)");
  });
});

describe("OnCallRow", () => {
  const t = { text2: "#5A6663" } as unknown as ThemeTokens;

  it("draws the phone beside the words, labelled for a screen reader", () => {
    const html = renderToStaticMarkup(<OnCallRow entry={{ date: "2026-10-14" }} name="Kaylene" color="#8A4B38" t={t} />);
    expect(html).toContain('aria-label="Kaylene is on call"');
    expect(html).toContain("Kaylene is on call</span>");
    expect(html).toContain("<svg");
    expect(html).toContain("color:#8A4B38");
  });

  it("marks a pending one", () => {
    const html = renderToStaticMarkup(<OnCallRow entry={{ date: "2026-10-20", pending: true }} name="Kaylene" color="#8A4B38" t={t} />);
    expect(html).toContain("Kaylene is on call (pending)");
  });
});
