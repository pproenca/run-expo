# @expo98/cli-argv-parser

Modernized raw argv parsing for the expo98 CLI.

This package preserves the legacy parser boundary:

- process-level global flags before the command
- command-local `--flag value` and `--flag=value` parsing
- command-local camelCase key projection
- simple boolean and numeric coercion for command-local values
- `--` passthrough into positional args
- `CliUsageError` for missing global values and unknown pre-command flags

## Verification

```bash
npm test
```

