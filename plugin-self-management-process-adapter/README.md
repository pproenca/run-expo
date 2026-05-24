# plugin-self-management-process-adapter

Subprocess adapter for `plugin-self-management`.

It provides the `execFile(file, args, options)` dependency used by release
checks, preserving the legacy non-rejecting process-result behavior while
letting final CLI composition inject Node's real `child_process.execFile`,
`process.env`, and package paths.
