# Agent Harness Config Audit

This audit maps root JSON/YAML-style OpenClaw harness files to the expo98 port. The goal is to preserve the useful agent workflow without importing OpenClaw's monorepo, plugin, release, channel, app, or maintainer infrastructure.

## Adapted

| Source | expo98 decision |
| --- | --- |
| `AGENTS.md` | Rewritten as expo98 root policy, preserving package, generated bundle, pnpm, safety, docs, test, git, and security rules. |
| `VISION.md` | Rewritten for the expo98 local evidence CLI direction and package guardrails. |
| `.agents/skills/autoreview/**` | Kept with helper scripts copied intact; skill instructions rewritten for expo98 review priorities. |
| `.agents/skills/openclaw-testing/**` | Adapted as `.agents/skills/expo98-testing/` with expo98 commands and package checks. |
| `.agents/skills/openclaw-debugging/**` | Adapted as `.agents/skills/expo98-debugging/` around CLI, policy, simulator, Metro, bridge, evidence, and bundle drift. |
| `.agents/skills/openclaw-docs/**` | Adapted as `.agents/skills/expo98-docs/` for README, SPEC, business rules, architecture, and vision docs. |
| `.agents/skills/crabbox/**` | Added as optional guidance only; OpenClaw's remote config is not copied. |
| `.gitignore` agent-skill rules | Adapted so local skill installs are ignored and only repo-owned selected skills are unignored. |

## Kept As expo98 Versions

| File | Decision |
| --- | --- |
| `package.json` | Keep expo98 package metadata, bins, scripts, dependencies, Node engine, and `files` allowlist. |
| `pnpm-workspace.yaml` | Keep single-package workspace and `onlyBuiltDependencies`; do not import OpenClaw monorepo packages or overrides. |
| `pnpm-lock.yaml` | Keep expo98 lockfile as the only package-manager lockfile. |
| `.gitignore` core cache/evidence rules | Keep expo98 ignores for `.scratch/`, caches, package tarballs, HARs, memory graphs, and local policy files. |

## Not Copied

| OpenClaw file or group | Reason |
| --- | --- |
| `.crabbox.yaml` | OpenClaw config targets OpenClaw CI hydration, env names, cache shape, and direct AWS defaults; only optional skill guidance was ported. |
| `.oxlintrc.json` | Large OpenClaw lint policy depends on dev dependencies and TS/Vitest layout not present in expo98. |
| `.pre-commit-config.yaml` | Runs OpenClaw-specific scripts, Swift tools, oxlint/oxfmt lanes, and skills Python tests not present in expo98. |
| `.github/actionlint.yaml` | Configures OpenClaw/Blacksmith runner labels and workflow exceptions; expo98 has no `.github` workflows currently. |
| `.github/dependabot.yml` | References OpenClaw registry secrets, Swift, Gradle, Docker, and monorepo directories; not safe to copy. |
| `.github/labeler.yml` | Labels OpenClaw plugins, channels, apps, gateway, docs, and commands; expo98 has no matching GitHub workflow in this repo. |
| `.github/package-trusted-sources.json` | OpenClaw package provenance policy is tied to its dependency and release process; expo98 should define its own if needed. |
| `.github/zizmor.yml` | Workflow-security config only matters if expo98 adds workflows; copying without workflows adds noise. |
| `.vscode/launch.json`, `.vscode/tasks.json` | Local editor tasks target OpenClaw commands and layouts; do not impose them on expo98. |
| `config/swiftlint.yml` | Native app Swift linting does not apply to this Node CLI package. |
| `docker-compose.yml` | OpenClaw service topology is unrelated to the expo98 CLI package. |
| `docs/docs.json` | Mintlify docs site configuration for OpenClaw; expo98 docs are local Markdown package docs. |
| `npm-shrinkwrap.json` | OpenClaw ships shrinkwraps for npm/package surfaces that expo98 does not use; expo98 standard is `pnpm-lock.yaml` only. |
| `package.json` | Do not copy; expo98 already owns its package contract, bins, scripts, dependencies, and publish allowlist. |
| `pnpm-lock.yaml` | Do not copy; expo98's lockfile matches its own dependency graph. |
| OpenClaw `pnpm-workspace.yaml` overrides and package lists | Tuned for OpenClaw's monorepo, extensions, patched dependencies, and release-age policy; not valid for expo98's single-package workspace. |
| `render.yaml` | OpenClaw deployment config is unrelated to expo98. |
| `scripts/clawtributors-map.json` | Maintainer/community triage data is OpenClaw-specific. |
| `scripts/tsconfig.json` | Script typecheck layout assumes OpenClaw's script toolchain and dependencies. |
| `test/tsconfig.json` | Vitest/tsgo test layout does not match expo98's Node test setup. |
| `tsconfig.json` | OpenClaw config assumes `src`, `ui`, `packages`, `extensions`, plugin SDK paths, and NodeNext aliases that expo98 does not use. |
| `tsconfig.core.json` | Core tsgo lane is OpenClaw-specific and includes UI/packages. |
| `tsconfig.core.projects.json` | Project references do not match expo98's single-package test setup. |
| `tsconfig.extensions.json` | Extension lane has no expo98 equivalent. |
| `tsconfig.extensions.projects.json` | Extension project references have no expo98 equivalent. |
| `tsconfig.plugin-sdk.dts.json` | Plugin SDK declaration generation is outside expo98 scope. |
| `tsconfig.projects.json` | OpenClaw project-reference graph is not applicable. |
| `ui/package.json` | OpenClaw Control UI is not part of expo98. |
| app Swift YAML/JSON | OpenClaw app/platform configs are unrelated to this Node CLI package. |
| `extensions/**/package.json`, `openclaw.plugin.json`, `tsconfig.json`, `npm-shrinkwrap.json` | Plugin/extension package configs are not part of expo98. |
| `packages/*/package.json` | OpenClaw SDK/package workspace configs do not apply to expo98. |
| `scripts/lib/*.json` and OpenClaw fixture JSON | Generated/catalog/test fixtures for OpenClaw runtime, providers, plugins, and CI are outside expo98 scope. |
| `qa/**`, `apps/**`, `security/opengrep/**` JSON/YAML | OpenClaw QA, native app, and security workflow config is not part of the expo98 publishable package. |

## Future Rule

When adding a new agent harness file to expo98, first decide whether it supports this package's local evidence CLI contract. If the file assumes OpenClaw plugins, channels, Gateway, native apps, release trains, or maintainer bots, document it here as not copied unless the expo98 product explicitly grows that surface.
