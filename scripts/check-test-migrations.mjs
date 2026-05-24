#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const migrationsDir = join(repoRoot, "packages/db/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

const setupFiles = [
  "apps/api/test/setup.ts",
  "packages/chat-room/test/setup.ts",
];

const failures = [];

for (const setupFile of setupFiles) {
  const source = readFileSync(join(repoRoot, setupFile), "utf8");
  for (const migration of migrations) {
    if (!source.includes(`migrations/${migration}`)) {
      failures.push(`${setupFile} does not import ${migration}`);
    }
  }
}

if (failures.length > 0) {
  console.error("[migration-test-guard] Test DB setup is missing migrations:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[migration-test-guard] ${migrations.length} migrations are imported by ${setupFiles.length} test setup files.`);
