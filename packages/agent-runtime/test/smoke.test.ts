import { describe, it, expect } from "vitest";
import { ClaudeRuntime, CodexRuntime, OpenClawRuntime, HermesRuntime } from "../src/index.js";
import type { AgentRuntime } from "../src/index.js";

describe("@raltic/agent-runtime smoke", () => {
  const runtimes: Array<{ name: string; instance: AgentRuntime; id: string }> = [
    { name: "ClaudeRuntime",   instance: new ClaudeRuntime(),   id: "claude" },
    { name: "CodexRuntime",    instance: new CodexRuntime(),    id: "codex" },
    { name: "OpenClawRuntime", instance: new OpenClawRuntime(), id: "openclaw" },
    { name: "HermesRuntime",   instance: new HermesRuntime(),   id: "hermes" },
  ];

  for (const { name, instance, id } of runtimes) {
    describe(name, () => {
      it("has the expected id", () => {
        expect(instance.id).toBe(id);
      });

      it("exposes a non-empty displayName", () => {
        expect(typeof instance.displayName).toBe("string");
        expect(instance.displayName.length).toBeGreaterThan(0);
      });

      it("declares capabilities with at least one model and a defaultModel", () => {
        const caps = instance.capabilities;
        expect(Array.isArray(caps.models)).toBe(true);
        expect(caps.models.length).toBeGreaterThan(0);
        expect(typeof caps.defaultModel).toBe("string");
        expect(caps.defaultModel.length).toBeGreaterThan(0);
        expect(Array.isArray(caps.permissionModes)).toBe(true);
        expect(caps.permissionModes.length).toBeGreaterThan(0);
      });

      it("exposes detect() and spawn() as functions", () => {
        expect(typeof instance.detect).toBe("function");
        expect(typeof instance.spawn).toBe("function");
      });
    });
  }
});
