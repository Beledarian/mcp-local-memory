import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const testDir = path.resolve("tests");
const testFiles = readdirSync(testDir)
  .filter((file) => file.endsWith(".test.ts"))
  .sort()
  .map((file) => path.join("tests", file));

if (testFiles.length === 0) {
  console.error("No authoritative *.test.ts files found.");
  process.exit(1);
}

const tsxCli = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
const result = spawnSync(
  process.execPath,
  [tsxCli, "--test", ...testFiles],
  {
    cwd: process.cwd(),
    env: { ...process.env, TEST_MODE: "true", USE_WORKER: "false" },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
