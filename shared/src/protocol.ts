import type { CrdtSnapshot, Operation } from './crdt.js'

export interface JoinDocumentPayload {
  readonly documentId: string
  readonly clientId: string
}

export interface OperationPayload {
  readonly documentId: string
  readonly operation: Operation
}

export interface CursorPosition {
  readonly index: number
}

export interface PresenceMember {
  readonly clientId: string
  readonly cursor?: CursorPosition
}

export interface DocumentState {
  readonly snapshot: CrdtSnapshot
  readonly operations: readonly Operation[]
  readonly presence: readonly PresenceMember[]
}

export interface ClientToServerEvents {
  'join-document': (payload: JoinDocumentPayload) => void
  operation: (payload: OperationPayload) => void
  'update-cursor': (payload: CursorPosition) => void
}

export interface ServerToClientEvents {
  'document-state': (state: DocumentState) => void
  operation: (operation: Operation) => void
  'operation-ack': (id: Operation['id']) => void
  presence: (members: readonly PresenceMember[]) => void
  'room-error': (error: { readonly message: string }) => void
}
