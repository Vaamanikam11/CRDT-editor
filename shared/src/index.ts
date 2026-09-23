export interface HealthResponse {
  status: 'ok'
  service: 'server'
  timestamp: string
}

export {
  ROOT_ID,
  SequenceCrdt,
  type CrdtElement,
  type CrdtSnapshot,
  type DeleteOperation,
  type ElementId,
  type InsertOperation,
  type Operation,
} from './crdt.js'

export type {
  ClientToServerEvents,
  CursorPosition,
  DocumentState,
  JoinDocumentPayload,
  OperationPayload,
  PresenceMember,
  ServerToClientEvents,
} from './protocol.js'
