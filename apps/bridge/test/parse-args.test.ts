/**
 * parseArgs contract — covers every supported input shape (positional,
 * named flag, comma-env, single-env, config-file) and the precedence
 * rules between them.
 *
 * Why the test exists:
 *   The wizard renders the command users copy-paste into a terminal. If
 *   parseArgs misreads the command, every solo signup fails at the
 *   "Run the bridge" step. The multi-key change adds significant
 *   surface area (positional accumulation, comma-env, config-file
 *   merge, dedup) that's easy to break silently — this suite locks
 *   each path.
 *
 * argv shape mirrors `process.argv` — index 0 is the node binary,
 * index 1 is the script path, real arguments start at index 2.
 */
import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/index";

const ARGV_PREFIX = ["/usr/bin/node", "/path/to/bridge"];

describe("parseArgs", () => {
  it("accepts a single positional ck_… as the api key", () => {
    const args = parseArgs([...ARGV_PREFIX, "ck_abc123"], {});
    expect(args.apiKeys).toEqual(["ck_abc123"]);
    expect(args.serverUrl).toBe("https://api.raltic.com");
  });

  it("accepts multiple positional ck_… tokens — one bridge per key", () => {
    const args = parseArgs([...ARGV_PREFIX, "ck_a", "ck_b", "ck_c"], {});
    expect(args.apiKeys).toEqual(["ck_a", "ck_b", "ck_c"]);
  });

  it("accepts repeated --api-key flags", () => {
    const args = parseArgs([...ARGV_PREFIX, "--api-key", "ck_a", "--api-key", "ck_b"], {});
    expect(args.apiKeys).toEqual(["ck_a", "ck_b"]);
  });

  it("accepts --api-key=value form", () => {
    const args = parseArgs([...ARGV_PREFIX, "--api-key=ck_eq"], {});
    expect(args.apiKeys).toEqual(["ck_eq"]);
  });

  it("merges flag + positional, flag entries come first (CLI parse order)", () => {
    // --api-key gets pushed during the loop; positional ck_ tokens are
    // also appended. Final order = parse order. Dedup keeps each unique
    // value once.
    const args = parseArgs([...ARGV_PREFIX, "--api-key", "ck_flag", "ck_positional"], {});
    expect(args.apiKeys).toEqual(["ck_flag", "ck_positional"]);
  });

  it("dedups identical keys across sources", () => {
    const args = parseArgs([...ARGV_PREFIX, "ck_a", "--api-key", "ck_a"], {
      RALTIC_API_KEY: "ck_a",
    });
    expect(args.apiKeys).toEqual(["ck_a"]);
  });

  it("RALTIC_API_KEYS comma-separated env produces multiple keys", () => {
    const args = parseArgs([...ARGV_PREFIX], { RALTIC_API_KEYS: "ck_env1,ck_env2" });
    expect(args.apiKeys).toEqual(["ck_env1", "ck_env2"]);
  });

  it("falls back to RALTIC_API_KEY single env when no CLI key + no comma env", () => {
    const args = parseArgs([...ARGV_PREFIX], { RALTIC_API_KEY: "ck_from_env" });
    expect(args.apiKeys).toEqual(["ck_from_env"]);
  });

  it("CLI keys win over env (CLI first, then env-comma, then env-single in order)", () => {
    const args = parseArgs([...ARGV_PREFIX, "ck_cli"], {
      RALTIC_API_KEYS: "ck_envA,ck_envB",
      RALTIC_API_KEY: "ck_envC",
    });
    expect(args.apiKeys).toEqual(["ck_cli", "ck_envA", "ck_envB", "ck_envC"]);
  });

  it("respects RALTIC_SERVER_URL when --server-url not given", () => {
    const args = parseArgs([...ARGV_PREFIX, "ck_x"], {
      RALTIC_SERVER_URL: "http://localhost:8787",
    });
    expect(args.serverUrl).toBe("http://localhost:8787");
  });

  it("--server-url overrides env", () => {
    const args = parseArgs([...ARGV_PREFIX, "ck_x", "--server-url", "https://staging.raltic.com"], {
      RALTIC_SERVER_URL: "http://localhost:8787",
    });
    expect(args.serverUrl).toBe("https://staging.raltic.com");
  });

  it("returns empty apiKeys when nothing is provided (main() then exits 1)", () => {
    const args = parseArgs([...ARGV_PREFIX], {});
    expect(args.apiKeys).toEqual([]);
    expect(args.serverUrl).toBe("https://api.raltic.com");
  });

  it("does NOT treat non-ck_ positional args as api keys", () => {
    const args = parseArgs([...ARGV_PREFIX, "my-laptop", "--api-key", "ck_real"], {});
    expect(args.apiKeys).toEqual(["ck_real"]);
  });

  it("respects RALTIC_AGENTS_DIR env", () => {
    const args = parseArgs([...ARGV_PREFIX, "ck_x"], {
      RALTIC_AGENTS_DIR: "/tmp/raltic-agents",
    });
    expect(args.agentsDir).toBe("/tmp/raltic-agents");
  });
});
