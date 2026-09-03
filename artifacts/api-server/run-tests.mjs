import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tempDir = await mkdtemp(join(tmpdir(), "forex-api-tests-"));
const output = join(tempDir, "market-structure.test.mjs");

try {
  await build({
    entryPoints: ["tests/market-structure.test.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: output,
    sourcemap: "inline",
    packages: "external",
  });
  await import(pathToFileURL(output).href);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
