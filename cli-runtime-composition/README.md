# cli-runtime-composition

Composition boundary for the modernized `expo-ios` CLI runtime.

This package wires the independently transformed parser, argument projector,
dispatch envelope, handler registry, run recorder, and facade entrypoint through
injected dependencies. It keeps the final executable assembly testable without
pulling process globals back into the command modules.
