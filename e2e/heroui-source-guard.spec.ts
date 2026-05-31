import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const WEB_SRC = path.join(ROOT, "apps/web/src");

const BUSINESS_RAW_CONTROL_ALLOWLIST = new Map<string, RegExp[]>([
  ["components/heroui-pro/dialog.tsx", [/<button\b/]],
  ["components/heroui-pro/alert-dialog.tsx", [/<button\b/]],
  ["components/heroui-pro/input.tsx", [/<input\b/]],
]);

const DIRECT_HEROUI_ALLOWLIST = new Set([
  "components/heroui-pro/accordion.tsx",
  "components/heroui-pro/alert-dialog.tsx",
  "components/heroui-pro/alert.tsx",
  "components/heroui-pro/button.tsx",
  "components/heroui-pro/card.tsx",
  "components/heroui-pro/chip.tsx",
  "components/heroui-pro/confirm-dialog.tsx",
  "components/heroui-pro/dialog.tsx",
  "components/heroui-pro/field.tsx",
  "components/heroui-pro/input.tsx",
  "components/heroui-pro/menu.tsx",
  "components/heroui-pro/radio.tsx",
  "components/heroui-pro/scroll-shadow.tsx",
  "components/heroui-pro/select.tsx",
  "components/heroui-pro/tabs.tsx",
  "components/heroui-pro/textarea.tsx",
  "components/heroui-pro/toast.tsx",
]);

const DIRECT_HEROUI_PRO_ALLOWLIST = new Set([
  "components/message-area.tsx",
  "components/sidebar.tsx",
  "components/workspace-shell.tsx",
  "components/heroui-pro/select.tsx",
]);

test("apps/web business UI stays behind HeroUI Pro wrappers", () => {
  const files = listFiles(WEB_SRC).filter((file) => file.endsWith(".tsx"));
  const rawControlViolations: string[] = [];
  const directHeroUiViolations: string[] = [];
  const directHeroUiProViolations: string[] = [];

  for (const file of files) {
    const rel = toRel(file);
    const source = stripComments(fs.readFileSync(file, "utf8"));
    const allowPatterns = BUSINESS_RAW_CONTROL_ALLOWLIST.get(rel) ?? [];

    for (const tag of ["button", "input", "select", "textarea", "dialog"]) {
      const pattern = new RegExp(`<${tag}\\b`, "g");
      const allowed = allowPatterns.some((allowedPattern) => allowedPattern.test(source));
      if (!allowed && pattern.test(source)) {
        rawControlViolations.push(`${rel}: raw <${tag}>`);
      }
    }

    if (!DIRECT_HEROUI_ALLOWLIST.has(rel) && /from\s+["']@heroui\/react\//.test(source)) {
      directHeroUiViolations.push(rel);
    }

    if (!DIRECT_HEROUI_PRO_ALLOWLIST.has(rel) && /from\s+["']@heroui-pro\/react\//.test(source)) {
      directHeroUiProViolations.push(rel);
    }
  }

  expect(rawControlViolations).toEqual([]);
  expect(directHeroUiViolations).toEqual([]);
  expect(directHeroUiProViolations).toEqual([]);
});

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return [full];
  });
}

function toRel(file: string) {
  return path.relative(WEB_SRC, file).split(path.sep).join("/");
}

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
