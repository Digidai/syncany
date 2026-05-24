import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // OpenNext build output is generated, gitignored, and contains
    // minified third-party JS — linting it produces nothing actionable
    // and drowns out signal from source-tree warnings.
    ".open-next/**",
  ]),
  {
    rules: {
      // Raltic has long-form marketing/legal copy in JSX. Requiring
      // HTML entities for every apostrophe makes diffs noisy without
      // changing runtime behavior.
      "react/no-unescaped-entities": "off",
      // The app uses plain img tags for user-provided avatars and
      // attachment previews where Next Image optimization is not useful
      // in the current Cloudflare deployment path.
      "@next/next/no-img-element": "off",
      // React Compiler lint rules are stricter than this app's current
      // data-loading pattern. Keep the correctness-focused hook rules,
      // but do not fail lint for ordinary effect-driven state sync.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
]);

export default eslintConfig;
