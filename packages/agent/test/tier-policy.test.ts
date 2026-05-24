import { describe, expect, it } from "vitest";
import { CLOUD_RUNTIME_MODELS } from "@raltic/protocol";
import { TIER_POLICIES } from "../src/types.js";

describe("cloud agent tier model policy", () => {
  it("allows every cloud runtime model until plan limits are loaded from billing", () => {
    for (const policy of Object.values(TIER_POLICIES)) {
      expect(policy.allowedModels).toEqual(CLOUD_RUNTIME_MODELS);
      expect(policy.allowedModels).toContain("claude-sonnet-4-6");
    }
  });
});
