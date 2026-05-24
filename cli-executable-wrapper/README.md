# cli-executable-wrapper

Process-level executable wrapper for the modernized `expo-ios` CLI.

It preserves the legacy executable tail that passes `process.argv.slice(2)` to
the CLI main function, assigns the returned exit code, and writes/classifies
errors if main rejects.
