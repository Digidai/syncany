import { describe, it, expect } from "vitest";
import { resolveWithinWorkspace } from "../src/security.js";

describe("resolveWithinWorkspace", () => {
  const root = "/workspace";

  it("resolves a simple relative path", () => {
    expect(resolveWithinWorkspace(root, "a/b.txt")).toBe("/workspace/a/b.txt");
  });

  it("normalizes . and ..", () => {
    expect(resolveWithinWorkspace(root, "./a/./b.txt")).toBe("/workspace/a/b.txt");
    expect(resolveWithinWorkspace(root, "a/../b.txt")).toBe("/workspace/b.txt");
  });

  it("rejects ../ escape", () => {
    expect(() => resolveWithinWorkspace(root, "../etc/passwd")).toThrow(/escapes workspace/);
    expect(() => resolveWithinWorkspace(root, "a/../../etc/passwd")).toThrow(/escapes workspace/);
  });

  it("rejects absolute path outside root", () => {
    expect(() => resolveWithinWorkspace(root, "/etc/passwd")).toThrow(/escapes workspace/);
    expect(() => resolveWithinWorkspace(root, "/workspace2/x")).toThrow(/escapes workspace/);
  });

  it("accepts absolute path inside root", () => {
    expect(resolveWithinWorkspace(root, "/workspace/x")).toBe("/workspace/x");
  });

  it("rejects null bytes", () => {
    expect(() => resolveWithinWorkspace(root, "a\0b")).toThrow(/null bytes/);
  });

  it("rejects empty / non-string", () => {
    expect(() => resolveWithinWorkspace(root, "")).toThrow(/non-empty/);
    // @ts-expect-error wrong type intentional
    expect(() => resolveWithinWorkspace(root, null)).toThrow(/non-empty/);
  });

  it("allows root itself", () => {
    expect(resolveWithinWorkspace(root, ".")).toBe("/workspace");
  });
});
