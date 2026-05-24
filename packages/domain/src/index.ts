/**
 * @expo98/domain — domain model (Effect `Schema` structs) + S7 Persistence.
 *
 * Public API surface. Consumers (handlers, CLI shell) import entity schemas,
 * the persistence service tag + layer, the fs port, and the pure decision
 * helpers from here.
 */

// Branded ids + canonical timestamp
export * from "./ids.js"

// Embedded value objects
export * from "./value-objects.js"

// Persisted entities (the four aggregates)
export * from "./entities.js"

// Error taxonomy
export * from "./errors.js"

// Filesystem port + in-memory test impl
export * from "./fs-port.js"

// On-disk layout
export * as Paths from "./paths.js"

// Name / duration / id calculation rules (AC-043, AC-034, AC-018)
export * from "./naming.js"

// Lenient-read / strict-write migration shim (§5)
export * as Migration from "./migration.js"

// Pure read-side decisions (AC-017, AC-018, AC-019, AC-026 renumber)
export * from "./decisions.js"

// S7 Persistence service
export {
  PersistenceService,
  makePersistence,
  layer as persistenceLayer,
  defaultClock
} from "./persist.js"
export type {
  Persistence,
  PersistenceClock,
  NewSessionInput,
  SessionListEntry,
  CleanInput
} from "./persist.js"
