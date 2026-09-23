/**
 * @field-edge/react-native — TypeScript wrapper for the FieldEdge Rust bridge.
 *
 * Re-exports the fieldEdge client from the mobile app for use by other
 * packages within the monorepo (e.g., shared utilities, test harnesses).
 */

export {
  fieldEdge,
  FieldEdgeClient,
  type PointInput,
  type Payload,
  type QueryRequest,
  type QueryHit,
  type FilterExpression,
  type SyncDiff,
  type ConflictDecision,
  type WalEntry,
} from '../../apps/mobile/src/native/fieldEdge';
