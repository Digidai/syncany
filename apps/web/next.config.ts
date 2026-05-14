import type { NextConfig } from "next";
import { resolve } from "node:path";

// Workspace root = two levels up from apps/web (this file's location).
// Hardcoding an absolute path breaks CI on a different machine.
const WORKSPACE_ROOT = resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: WORKSPACE_ROOT,
  turbopack: {
    root: WORKSPACE_ROOT,
  },
};

export default nextConfig;
