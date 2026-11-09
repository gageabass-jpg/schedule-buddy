import { describe, expect, it } from "vitest";
import { cleanAppPassword, isIcloudAddress } from "./icloudAccount";

describe("isIcloudAddress", () => {
  it("accepts the domains iCloud Mail uses, whatever the case", () => {
    expect(isIcloudAddress("gage@icloud.com")).toBe(true);
    expect(isIcloudAddress("  Gage@ME.com ")).toBe(true);
    expect(isIcloudAddress("gage@mac.com")).toBe(true);
  });

  it("refuses other domains, lookalikes and things that aren't addresses", () => {
    expect(isIcloudAddress("gage@gmail.com")).toBe(false);
    expect(isIcloudAddress("gage@icloud.com.evil.com")).toBe(false);
    expect(isIcloudAddress("gage@notmac.com")).toBe(false);
    expect(isIcloudAddress("icloud.com")).toBe(false);
    expect(isIcloudAddress("")).toBe(false);
  });
});

describe("cleanAppPassword", () => {
  it("writes it the way Apple does, however it was typed or pasted", () => {
    expect(cleanAppPassword("abcd-efgh-ijkl-mnop")).toBe("abcd-efgh-ijkl-mnop");
    expect(cleanAppPassword(" ABCD EFGH IJKL MNOP ")).toBe("abcd-efgh-ijkl-mnop");
    expect(cleanAppPassword("abcdefghijklmnop")).toBe("abcd-efgh-ijkl-mnop");
  });

  it("rejects an Apple ID password and anything that isn't sixteen letters", () => {
    expect(cleanAppPassword("MyApplePassword1!")).toBeUndefined();
    expect(cleanAppPassword("abcd-efgh-ijkl")).toBeUndefined();
    expect(cleanAppPassword("abcd-efgh-ijkl-mnop-qrst")).toBeUndefined();
    expect(cleanAppPassword("abcd-efgh-1234-mnop")).toBeUndefined();
    expect(cleanAppPassword("")).toBeUndefined();
  });
});
