#!/usr/bin/env node
import path from "node:path"

const mode = process.argv[2]
const rawArgs = process.argv.slice(3)
const files = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs

if (mode !== "lint" && mode !== "format") {
  process.stderr.write("usage: filter-staged-files.mjs <lint|format> -- <files...>\n")
  process.exit(2)
}

const lintExts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])
const formatExts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md", ".mdx"])

function shouldSelect(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return mode === "lint" ? lintExts.has(ext) : formatExts.has(ext)
}

for (const file of files) {
  if (shouldSelect(file)) {
    process.stdout.write(file)
    process.stdout.write("\0")
  }
}
