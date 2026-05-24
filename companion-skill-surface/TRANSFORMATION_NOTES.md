# companion-skill-surface Transformation Notes

## Scope

This slice modernizes the bundled companion skill document:

- `legacy/expo98/skills/expo-ios-cli/SKILL.md`

It also preserves the frontmatter parsing behavior used by the legacy bundled
CLI skill listing command.

## Mapping

| Legacy source | Modern target | Behavior |
| --- | --- | --- |
| `legacy/expo98/skills/expo-ios-cli/SKILL.md:1-4` | `src/main/index.ts:36-66`, `src/main/index.ts:94-99` | Preserves skill frontmatter name and description. |
| `legacy/expo98/skills/expo-ios-cli/SKILL.md:6-8` | `src/main/index.ts:53-59`, `src/main/index.ts:101-103` | Preserves title and summary guidance. |
| `legacy/expo98/skills/expo-ios-cli/SKILL.md:10-16` | `src/main/index.ts:1-7`, `src/main/index.ts:105-107` | Preserves CLI contract bullets. |
| `legacy/expo98/skills/expo-ios-cli/SKILL.md:18-34` | `src/main/index.ts:9-21`, `src/main/index.ts:109-119` | Preserves start and evidence command examples. |
| `legacy/expo98/skills/expo-ios-cli/SKILL.md:36-44` | `src/main/index.ts:23-34`, `src/main/index.ts:121-125` | Preserves next-step, tool, and mutation-safety guidance. |
| `legacy/expo98/dist/expo-ios.mjs:8841-8850` | `src/main/index.ts:68-92` | Preserves frontmatter metadata parsing shape for skill discovery. |

## Deliberate Deviations

- The legacy artifact is Markdown. The modern package stores the same guidance as
  structured data and provides `renderCompanionSkillMarkdown()` to regenerate the
  shipped document.
- The parser only returns `name` and `description`, because those are the fields
  consumed by the legacy `skills list/get` behavior for this bundled skill.

## Not Migrated

- Filesystem scanning for bundled skills is already covered by
  `plugin-self-management`.
- This package does not execute any CLI commands from the guidance examples.

## Review Notes

- Architecture review was performed locally. No high-severity issues were
  found; the package is deterministic and side-effect free.
- Final packaging can use this module with `package-entrypoints` to keep the
  shipped skill guidance version-aligned with the modernized CLI.

