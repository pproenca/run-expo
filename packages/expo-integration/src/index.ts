/**
 * `@expo98/expo-integration` — D9 (in-app devtools bridge) + D5 (Expo/RN
 * introspection) services of the Effect-TS expo98 rebuild.
 *
 * Surface:
 *   - Bridge install/remove   (AC-008, `source-write` via core's dispatch + token)
 *   - Bridge install-state    (AC-027, a `read` over the `Fs` port)
 *   - Bridge runtime-health   (AC-028, the real ordered state machine; AC-009)
 *   - Bridge domain actions    (AC-006, storage/state/controls gated+bounded)
 *   - Expo↔RN compat           (AC-020, classified from a DATA FILE)
 *   - Expo Router sitemap       (AC-044, path normalization)
 *
 * The official Expo SDK (live `expo config` parsing, in-app bridge delivery) is a
 * documented `// SEAM (Expo SDK)`: it needs the TARGET project's Expo install,
 * not ours. The Expo→RN compat map lives in a DATA FILE
 * (`src/data/expo-rn-compat.json`) so it updates without a code release.
 */

// Bridge artifacts + layout (AC-008/009/027/028)
export {
  BRIDGE_DOMAINS,
  BRIDGE_SCHEMA_VERSION,
  bridgeFilePaths,
  type BridgeFilePaths,
  bridgeMetadata,
  bridgeMetadataContents,
  bridgeSourceContents,
  EXPO98_BRIDGE_VERSION,
} from "./bridge-files.js"

// Bridge install / remove (AC-008)
export {
  bridgeInstall,
  BRIDGE_INSTALL_TOKEN,
  bridgeRemove,
  BRIDGE_REMOVE_TOKEN,
  type BridgeConfirmationRequired,
  type BridgePlan,
  type BridgeWriteAction,
  type BridgeWritePayload,
  type BridgeWriteResult,
  installPlan,
  installWriteCommand,
  removePlan,
  removeWriteCommand,
} from "./install.js"

// Bridge install-state (AC-027)
export { type InstallIssue, type InstallStateResult, type InstallStatus, readInstallState } from "./install-state.js"

// Bridge runtime-health state machine (AC-028, AC-009)
export {
  bridgeHealth,
  type HealthInput,
  type HealthReady,
  type HealthResult,
  type HealthStep,
  type HealthUnavailable,
  type HealthUnavailableCode,
  REGISTRATION_PROBE_EXPRESSION,
} from "./health.js"

// Bridge transport SEAM stays internal; public callers use `runDomainAction`,
// which routes mutations through core dispatch before this transport is touched.
export { type BridgeCallResult, type BridgeTransportService, type BridgeUnavailableCode } from "./bridge-transport.js"

// Bridge domain actions (AC-006)
export {
  type DomainActionEvidence,
  type DomainActionInput,
  type DomainActionResult,
  domainActionKey,
  domainActionSideEffect,
  type DomainName,
  runDomainAction,
} from "./domain-actions.js"

// Size-bounding (AC-006)
export { boundBridgeValue, MAX_ARRAY_ITEMS, MAX_OUTPUT } from "./bound.js"

// Expo↔RN compatibility classification (AC-020)
export {
  classifyCompat,
  type CompatClass,
  type CompatMap,
  type CompatResult,
  DEFAULT_COMPAT_MAP,
  parseVersion,
  UNRESOLVED_PREFIXES,
} from "./compat.js"

// Expo / RN introspection (D5; Expo SDK seam + static fallback)
export { classifyProjectCompat, type DeclaredVersions, extractDeclaredVersions } from "./introspect.js"

// Expo Router sitemap normalization (AC-044)
export { buildSitemap, formatSegment, normalizeRoutePath, type SitemapEntry, type SitemapKind } from "./sitemap.js"
