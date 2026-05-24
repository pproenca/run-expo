import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("cli", { recursive: true });

await build({
  entryPoints: ["src/bundled-cli.ts"],
  outfile: "cli/expo98.mjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: [],
  logLevel: "silent",
});
