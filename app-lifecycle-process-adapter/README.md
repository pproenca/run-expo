# app-lifecycle-process-adapter

Subprocess adapter for `app-lifecycle-actions`.

It provides an `execFile(file, args, options)` dependency with the legacy
`execFilePromise` behavior used by lifecycle actions such as simulator boot,
app launch, app install/uninstall, and app log collection.
