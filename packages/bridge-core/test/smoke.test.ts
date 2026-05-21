import { describe, it, expect } from "vitest";
import {
  Bridge,
  AgentManager,
  buildSystemPrompt,
} from "../src/index.js";
import { buildRuntimeRegistry } from "@raltic/agent-runtime";

describe("@raltic/bridge-core smoke", () => {
  it("Bridge is a constructable class", () => {
    expect(typeof Bridge).toBe("function");
    expect(typeof Bridge.prototype.constructor).toBe("function");
  });

  it("AgentManager is exported as a class", () => {
    expect(typeof AgentManager).toBe("function");
  });

  it("buildSystemPrompt returns a non-empty string and includes the agent name", () => {
    const prompt = buildSystemPrompt(
      {
        display_name: "Smoke Bot",
        name: "smokebot",
        description: "Test agent",
        system_prompt: null,
      },
      ""
    );
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain("Smoke Bot");
    expect(prompt).toContain("@smokebot");
  });

  it("buildRuntimeRegistry returns claude + codex entries", () => {
    const reg = buildRuntimeRegistry();
    expect(reg.claude).toBeDefined();
    expect(reg.codex).toBeDefined();
    expect(reg.claude.id).toBe("claude");
    expect(reg.codex.id).toBe("codex");
  });
});
