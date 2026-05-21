/**
 * Unit tests for agent-dispatch (mention extraction).
 *
 * Codex review caught the prior P0 implementation:
 *   - Only matched @<UUID>, missed @<agent-name>
 *
 * These regressions encode both forms.
 */
import { describe, it, expect } from "vitest";
import { extractAgentMentions, type ChannelAgentRef } from "../../../apps/api/src/lib/agent-dispatch.js";

const AGENTS: ChannelAgentRef[] = [
  { id: "11111111-2222-3333-4444-555555555555", name: "code-reviewer" },
  { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", name: "weekly-summary" },
  { id: "12345678-90ab-cdef-1234-567890abcdef", name: "deploy-bot" },
];

describe("extractAgentMentions", () => {
  it("matches @<UUID> form", () => {
    const got = extractAgentMentions(
      "ping @11111111-2222-3333-4444-555555555555 for review",
      AGENTS,
    );
    expect(got).toEqual(["11111111-2222-3333-4444-555555555555"]);
  });

  it("matches @<agent-name> form", () => {
    const got = extractAgentMentions(
      "hey @code-reviewer can you check the PR?",
      AGENTS,
    );
    expect(got).toEqual(["11111111-2222-3333-4444-555555555555"]);
  });

  it("matches multiple agents at once", () => {
    const got = extractAgentMentions(
      "@code-reviewer and @deploy-bot please coordinate",
      AGENTS,
    );
    expect(got.sort()).toEqual([
      "11111111-2222-3333-4444-555555555555",
      "12345678-90ab-cdef-1234-567890abcdef",
    ].sort());
  });

  it("ignores unknown names", () => {
    const got = extractAgentMentions("ping @unknown-agent", AGENTS);
    expect(got).toEqual([]);
  });

  it("ignores @-tokens inside words (e.g. emails)", () => {
    const got = extractAgentMentions(
      "send to alice@code-reviewer.example.com please",
      AGENTS,
    );
    expect(got).toEqual([]);
  });

  it("deduplicates the same agent mentioned twice", () => {
    const got = extractAgentMentions(
      "@code-reviewer @code-reviewer @code-reviewer",
      AGENTS,
    );
    expect(got).toEqual(["11111111-2222-3333-4444-555555555555"]);
  });

  it("returns empty for content with no mentions", () => {
    expect(extractAgentMentions("just a normal message", AGENTS)).toEqual([]);
  });
});
