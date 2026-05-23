/**
 * Unit tests for OpenClawRuntime — pure parser + helper coverage.
 *
 * Doesn't exercise the live CLI (no `openclaw` binary required for
 * `pnpm test`). The integration test that exercises a real daemon
 * lives in apps/bridge/test and is gated on
 * RALTIC_RUN_OPENCLAW_INTEGRATION=1.
 *
 * Coverage targets:
 *   - parseOpenClawEvent: malformed input → null (never throws)
 *   - mapThinking: every PermissionMode lands on a valid level
 *   - describeOpenClawTool: known tools get specific labels; unknown
 *     fall through cleanly
 *   - classifyError: keyword categorisation
 *   - consumeLines: NDJSON buffer split
 */
import { describe, it, expect } from "vitest";
import {
  parseOpenClawEvent,
  describeOpenClawTool,
  mapThinking,
  classifyError,
  consumeLines,
} from "../src/openclaw.js";

describe("parseOpenClawEvent", () => {
  it("returns null for empty / whitespace lines", () => {
    expect(parseOpenClawEvent("")).toBeNull();
    expect(parseOpenClawEvent("   ")).toBeNull();
    expect(parseOpenClawEvent("\n")).toBeNull();
  });

  it("returns null for non-JSON banner lines", () => {
    expect(parseOpenClawEvent("starting openclaw agent...")).toBeNull();
    expect(parseOpenClawEvent("Error: not a JSON line")).toBeNull();
  });

  it("returns null when type field is missing", () => {
    expect(parseOpenClawEvent(JSON.stringify({ data: "no type" }))).toBeNull();
  });

  it("parses agent_message events", () => {
    const ev = parseOpenClawEvent(JSON.stringify({
      type: "agent_message",
      text: "Hello, world",
      replaces: true,
    }));
    expect(ev?.type).toBe("agent_message");
    expect(ev?.text).toBe("Hello, world");
    expect(ev?.replaces).toBe(true);
  });

  it("parses tool_use events with input object", () => {
    const ev = parseOpenClawEvent(JSON.stringify({
      type: "tool_use",
      name: "shell",
      input: { command: "ls -la" },
    }));
    expect(ev?.toolName).toBe("shell");
    expect(ev?.toolInput).toEqual({ command: "ls -la" });
  });

  it("recognises threadId in multiple shapes", () => {
    expect(parseOpenClawEvent(JSON.stringify({ type: "x", thread: "thr_1" }))?.threadId).toBe("thr_1");
    expect(parseOpenClawEvent(JSON.stringify({ type: "x", threadId: "thr_2" }))?.threadId).toBe("thr_2");
    expect(parseOpenClawEvent(JSON.stringify({ type: "x", sessionId: "thr_3" }))?.threadId).toBe("thr_3");
  });

  it("extracts error message from error events", () => {
    const ev = parseOpenClawEvent(JSON.stringify({
      type: "error",
      message: "Provider auth failed",
    }));
    expect(ev?.error).toBe("Provider auth failed");
  });
});

describe("mapThinking", () => {
  it("maps every PermissionMode", () => {
    expect(mapThinking("readOnly")).toBe("low");
    expect(mapThinking("default")).toBe("medium");
    expect(mapThinking("acceptEdits")).toBe("high");
    expect(mapThinking("bypassPermissions")).toBe("high");
  });
});

describe("describeOpenClawTool", () => {
  it("labels shell / bash with command snippet", () => {
    expect(describeOpenClawTool("shell", { command: "echo hi" }).label).toBe("Running command");
    expect(describeOpenClawTool("shell", { command: "echo hi" }).detail).toBe("echo hi");
    expect(describeOpenClawTool("bash", { command: "ls" }).label).toBe("Running command");
  });

  it("labels file ops with path snippet", () => {
    expect(describeOpenClawTool("read_file", { path: "/etc/hosts" }).label).toBe("Reading file");
    expect(describeOpenClawTool("write_file", { path: "/tmp/x" }).label).toBe("Writing file");
    expect(describeOpenClawTool("edit_file", { path: "src/a.ts" }).label).toBe("Editing file");
  });

  it("falls through to generic for unknown tools without throwing", () => {
    const r = describeOpenClawTool("totally_new_tool", { foo: "bar" });
    expect(r.label).toBe("Running totally_new_tool");
    expect(r.detail).toBe("");
  });

  it("truncates long input strings to 80 chars", () => {
    const longCmd = "echo " + "x".repeat(200);
    expect(describeOpenClawTool("shell", { command: longCmd }).detail.length).toBeLessThanOrEqual(80);
  });

  it("handles missing input fields gracefully", () => {
    expect(() => describeOpenClawTool("shell", {})).not.toThrow();
    expect(describeOpenClawTool("read_file", {}).detail).toBe("");
  });
});

describe("classifyError", () => {
  it("recognises auth errors", () => {
    expect(classifyError("unauthorized: invalid key")).toBe("auth");
    expect(classifyError("API key expired")).toBe("auth");
  });
  it("recognises rate limit", () => {
    expect(classifyError("rate limit exceeded")).toBe("rate_limit");
    expect(classifyError("HTTP 429 Too Many Requests")).toBe("rate_limit");
  });
  it("recognises network", () => {
    expect(classifyError("ENOTFOUND api.openai.com")).toBe("network");
    expect(classifyError("timeout after 30s")).toBe("network");
  });
  it("falls through to 'other' for unrecognised", () => {
    expect(classifyError("the moon ate my homework")).toBe("other");
  });
});

describe("consumeLines", () => {
  it("returns no lines when no newline", () => {
    let rest = "";
    expect(consumeLines("incomplete", (r) => { rest = r; })).toEqual([]);
    expect(rest).toBe("incomplete");
  });

  it("returns complete lines, keeps the partial tail", () => {
    let rest = "";
    const lines = consumeLines("a\nb\npartial", (r) => { rest = r; });
    expect(lines).toEqual(["a", "b"]);
    expect(rest).toBe("partial");
  });

  it("handles empty lines correctly", () => {
    let rest = "";
    const lines = consumeLines("a\n\nb\n", (r) => { rest = r; });
    expect(lines).toEqual(["a", "", "b"]);
    expect(rest).toBe("");
  });
});
