import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(root, "node_modules", "@fission-ai", "openspec", "bin", "openspec.js");
const args = ["validate", "--strict", "--no-interactive", ...process.argv.slice(2)];

const result = spawnSync(process.execPath, [cliPath, ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    OPENSPEC_TELEMETRY: "0",
    DO_NOT_TRACK: "1"
  }
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
