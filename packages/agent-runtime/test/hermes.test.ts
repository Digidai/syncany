/**
 * Unit tests for HermesRuntime — same shape as openclaw.test.ts but
 * exercises Hermes-specific event types (skill.start, memory_recall).
 */
import { describe, it, expect } from "vitest";
import {
  parseHermesEvent,
  describeHermesTool,
  mapPermissionMode,
  classifyError,
  consumeLines,
} from "../src/hermes.js";

describe("parseHermesEvent", () => {
  it("returns null on empty / non-JSON / no-type lines", () => {
    expect(parseHermesEvent("")).toBeNull();
    expect(parseHermesEvent("starting hermes agent")).toBeNull();
    expect(parseHermesEvent(JSON.stringify({ no_type: 1 }))).toBeNull();
  });

  it("captures session / thread id from multiple field names", () => {
    expect(parseHermesEvent(JSON.stringify({ type: "x", session: "s_1" }))?.threadId).toBe("s_1");
    expect(parseHermesEvent(JSON.stringify({ type: "x", sessionId: "s_2" }))?.threadId).toBe("s_2");
    expect(parseHermesEvent(JSON.stringify({ type: "x", thread: "s_3" }))?.threadId).toBe("s_3");
  });

  it("captures text from text / content fields", () => {
    expect(parseHermesEvent(JSON.stringify({ type: "x", text: "a" }))?.text).toBe("a");
    expect(parseHermesEvent(JSON.stringify({ type: "x", content: "b" }))?.text).toBe("b");
  });

  it("captures tool from tool / name fields", () => {
    expect(parseHermesEvent(JSON.stringify({ type: "tool.start", tool: "shell" }))?.toolName).toBe("shell");
    expect(parseHermesEvent(JSON.stringify({ type: "tool.start", name: "shell" }))?.toolName).toBe("shell");
  });

  it("extracts skillName for skill events", () => {
    const ev = parseHermesEvent(JSON.stringify({ type: "skill.start", skill: "summarize_pdf" }));
    expect(ev?.skillName).toBe("summarize_pdf");
  });
});

describe("describeHermesTool", () => {
  it("recognises shell aliases", () => {
    expect(describeHermesTool("shell", { command: "ls" }).label).toBe("Running command");
    expect(describeHermesTool("exec", { cmd: "ls" }).detail).toBe("ls");
  });

  it("recognises file ops with path or file field", () => {
    expect(describeHermesTool("read", { path: "/x" }).label).toBe("Reading file");
    expect(describeHermesTool("read_file", { file: "/y" }).detail).toBe("/y");
    expect(describeHermesTool("write", { path: "/x" }).label).toBe("Writing file");
    expect(describeHermesTool("write_file", { file: "/y" }).label).toBe("Writing file");
    expect(describeHermesTool("edit", { path: "/x" }).label).toBe("Editing file");
    expect(describeHermesTool("patch", { path: "/y" }).label).toBe("Editing file");
  });

  it("recognises memory ops", () => {
    expect(describeHermesTool("memory", { query: "user prefs" }).label).toBe("Recalling memory");
    expect(describeHermesTool("recall", { query: "x" }).label).toBe("Recalling memory");
  });

  it("recognises web ops", () => {
    expect(describeHermesTool("browse", { url: "https://x" }).label).toBe("Browsing web");
    expect(describeHermesTool("web", { url: "https://y" }).label).toBe("Browsing web");
  });

  it("falls through for unknown tools", () => {
    expect(describeHermesTool("hermes_specific_skill", {}).label).toBe("Running hermes_specific_skill");
  });
});

describe("mapPermissionMode", () => {
  it("maps every mode", () => {
    expect(mapPermissionMode("readOnly")).toBe("readonly");
    expect(mapPermissionMode("default")).toBe("confirm");
    expect(mapPermissionMode("acceptEdits")).toBe("auto");
    expect(mapPermissionMode("bypassPermissions")).toBe("auto");
  });
});

describe("classifyError", () => {
  it("recognises auth", () => {
    expect(classifyError("invalid API key")).toBe("auth");
    expect(classifyError("unauthorized")).toBe("auth");
  });
  it("recognises rate limit", () => {
    expect(classifyError("rate limit hit")).toBe("rate_limit");
  });
  it("recognises budget", () => {
    expect(classifyError("insufficient credits")).toBe("budget");
    expect(classifyError("quota exceeded")).toBe("budget");
  });
  it("recognises permission", () => {
    expect(classifyError("forbidden")).toBe("permission_denied");
  });
  it("other for unknown", () => {
    expect(classifyError("hermes broke")).toBe("other");
  });
});

describe("consumeLines (shared helper)", () => {
  it("handles a multi-line buffer with a partial tail", () => {
    let rest = "";
    const lines = consumeLines("event1\nevent2\nincomplete", (r) => { rest = r; });
    expect(lines).toEqual(["event1", "event2"]);
    expect(rest).toBe("incomplete");
  });
});
