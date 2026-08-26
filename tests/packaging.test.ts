import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

test("package allowlist excludes arbitrary local extensions", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.version, "2.1.0");
  assert.equal(packageJson.engines.node, ">=22.0.0");
  assert.equal(packageJson.license, "MIT");
  assert.equal(
    packageJson.repository.url,
    "git+https://github.com/Beledarian/mcp-local-memory.git",
  );
  assert.ok(packageJson.files.includes("CHANGELOG.md"));
  assert.ok(packageJson.files.includes("extensions/soul_maintenance.js"));
  assert.ok(packageJson.files.includes("docs/image.png"));
  assert.ok(packageJson.files.includes("docs/detailed_prompt.md"));
  assert.ok(packageJson.files.includes("docs/example_instructions.md"));
  assert.ok(packageJson.files.includes("docs/example_prompt.md"));
  assert.ok(packageJson.files.includes("scripts/normalize-importance.mjs"));
  assert.ok(packageJson.files.includes("scripts/smoke-live-mcp.mjs"));
  assert.ok(
    packageJson.files.includes(
      "scripts/build-sqlite-vec-windows-arm64.ps1",
    ),
  );
  assert.ok(
    packageJson.files.includes(
      "vendor/sqlite-vec/windows-arm64/vec0.dll",
    ),
  );
  assert.ok(!packageJson.files.includes("extensions/**/*"));
  const arm64DllHash = createHash("sha256")
    .update(readFileSync("vendor/sqlite-vec/windows-arm64/vec0.dll"))
    .digest("hex");
  assert.equal(
    arm64DllHash,
    "995e679c4098d5e266719637c86a85bead623bf9850f4b250c6180593047723c",
  );
});
