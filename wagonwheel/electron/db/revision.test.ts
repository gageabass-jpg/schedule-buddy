import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { Workspace } from "./repo.js";
import { nextRevision } from "./revision.js";

const make = (withRevision: boolean): Workspace => {
  let n = 0;
  return new Workspace(openDatabase(":memory:"), () => 1_000_000, () => `id-${++n}`, withRevision ? nextRevision : undefined);
};

describe("snapshot revision", () => {
  it("is absent when nothing counts, as in the connector", () => {
    const ws = make(false);
    expect("revision" in ws.snapshot()).toBe(false);
    expect("revision" in ws.createProject({ name: "A" }).snapshot).toBe(false);
  });

  it("rises with every read, including the snapshot a change returns", () => {
    const ws = make(true);
    const first = ws.snapshot().revision as number;
    const afterChange = ws.createProject({ name: "A" }).snapshot.revision as number;
    const second = ws.snapshot().revision as number;
    expect(afterChange).toBeGreaterThan(first);
    expect(second).toBeGreaterThan(afterChange);
  });

  it("keeps rising when the Workspace is made again, as after a restore", () => {
    const before = make(true).snapshot().revision as number;
    const after = make(true).snapshot().revision as number;
    expect(after).toBeGreaterThan(before);
  });
});
