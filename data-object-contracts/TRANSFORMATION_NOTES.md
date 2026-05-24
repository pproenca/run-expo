# data-object-contracts Transformation Notes

## Scope

This slice modernizes core DTO contracts from:

- `legacy/expo98/src/contracts/primitives.ts`
- `legacy/expo98/src/contracts/records.ts`
- `legacy/expo98/src/contracts/results.ts`

Output lives in `modernized/expo98/data-object-contracts/`.

## Mapping

| Legacy source | Modern target | Behavior |
| --- | --- | --- |
| `legacy/expo98/src/contracts/primitives.ts:1-18` | `src/main/index.ts:47-64` | Preserves JSON, platform, and availability primitives. |
| `legacy/expo98/src/contracts/primitives.ts:20-37` | `src/main/index.ts:1-12`, `src/main/index.ts:51-55` | Preserves confidence, build context, command exit code, and failure type vocabularies as runtime constants and unions. |
| `legacy/expo98/src/contracts/primitives.ts:39-55` | `src/main/index.ts:66-82`, `src/main/index.ts:330-347` | Preserves command failure, warning, and outcome shapes with helper constructors. |
| `legacy/expo98/src/contracts/primitives.ts:57-95` | `src/main/index.ts:10`, `src/main/index.ts:84-111`, `src/main/index.ts:349-359` | Preserves artifact, time range, schema, redaction rule, and snapshot ref primitives. |
| `legacy/expo98/src/contracts/records.ts:11-50` | `src/main/index.ts:14`, `src/main/index.ts:113-152` | Preserves run, session, and sidecar record shapes and sidecar status vocabulary. |
| `legacy/expo98/src/contracts/records.ts:52-81` | `src/main/index.ts:15-16`, `src/main/index.ts:154-183` | Preserves target, device, app process, and Metro target summaries. |
| `legacy/expo98/src/contracts/records.ts:83-150` | `src/main/index.ts:17-23`, `src/main/index.ts:185-249` | Preserves snapshot, ref, snapshot node, source location, box, source, and ref action shapes. |
| `legacy/expo98/src/contracts/records.ts:165-170` | `src/main/index.ts:250-257`, `src/main/index.ts:361-381` | Preserves evidence packet shape and adds a defensive constructor. |
| `legacy/expo98/src/contracts/results.ts:15-51` | `src/main/index.ts:25`, `src/main/index.ts:259-286` | Preserves doctor/project/app config result shapes and package manager vocabulary. |
| `legacy/expo98/src/contracts/results.ts:98-122` | `src/main/index.ts:26-35`, `src/main/index.ts:287-303` | Preserves DevTools capability/status shapes and capability source vocabulary. |
| `legacy/expo98/src/contracts/results.ts:124-155` | `src/main/index.ts:36-45`, `src/main/index.ts:304-328` | Preserves performance result/report shapes and metric unit/source vocabularies. |

## Deliberate Deviations

- The legacy contract files were type-only. The modern package emits runtime
  constants for enum-like unions so other packages can assert compatibility at
  runtime.
- `DoctorResult.capabilities` is represented as `Record<string, boolean>` while
  preserving the payload role. The legacy named capability object can be
  narrowed by project-info specific modules that own that result construction.
- `createEvidencePacket` defensively copies artifacts, summary, and limitations
  so characterization tests can prove the DTO boundary is immutable from caller
  mutation.

## Not Migrated

- No persistence, device discovery, snapshot capture, or performance collection
  behavior is implemented here.
- Full `UxContextResult` helper construction remains in the already transformed
  `ux-context-capture` slice.

## Review Notes

- Architecture review was performed locally. No high-severity issues were
  found; the package is deterministic and side-effect free.
- Future modules can import these constants instead of duplicating literal
  vocabularies for artifacts, records, and performance payloads.

