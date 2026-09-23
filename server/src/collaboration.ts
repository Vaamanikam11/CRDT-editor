import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import {
  SequenceCrdt,
  type ClientToServerEvents,
  type CursorPosition,
  type CrdtSnapshot,
  type DocumentState,
  type Operation,
  type OperationPayload,
  type PresenceMember,
  type ServerToClientEvents,
} from '@crdt-editor/shared'
import { MemoryOperationStore, type OperationStore } from './store.js'

interface SocketData {
  documentId?: string
  clientId?: string
  cursor?: CursorPosition
}

type CollaborationSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>
type CollaborationIo = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>

interface DocumentSession {
  readonly crdt: SequenceCrdt
  snapshot: CrdtSnapshot
  readonly operations: Operation[]
  readonly clients: Map<string, string>
}

const roomFor = (documentId: string): string => `document:${documentId}`
const operationKey = (operation: Operation): string =>
  `${operation.id.siteId}\u0000${operation.id.clock}`

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

export class CollaborationServer {
  readonly io: CollaborationIo
  private readonly documents = new Map<string, DocumentSession>()

  constructor(
    httpServer: HttpServer,
    private readonly store: OperationStore = new MemoryOperationStore(),
  ) {
    this.io = new Server<
      ClientToServerEvents,
      ServerToClientEvents,
      Record<string, never>,
      SocketData
    >(httpServer, {
      cors: { origin: true },
    })

    this.io.on('connection', (socket) => {
      socket.on('join-document', (payload) => {
        void this.joinDocument(socket, payload)
      })
      socket.on('operation', (payload) => {
        void this.receiveOperation(socket, payload)
      })
      socket.on('update-cursor', (cursor) => this.updateCursor(socket, cursor))
      socket.on('disconnect', () => this.leaveDocument(socket))
    })
  }

  async close(): Promise<void> {
    await this.io.close()
    await this.store.close()
  }

  private async joinDocument(
    socket: CollaborationSocket,
    payload: { readonly documentId?: unknown; readonly clientId?: unknown },
  ): Promise<void> {
    if (
      !isNonEmptyString(payload.documentId) ||
      !isNonEmptyString(payload.clientId)
    ) {
      socket.emit('room-error', {
        message: 'documentId and clientId are required',
      })
      return
    }

    this.leaveDocument(socket)

    let document = this.documents.get(payload.documentId)
    if (!document) {
      const stored = await this.store.load(payload.documentId)
      document = {
        crdt: SequenceCrdt.fromSnapshot(stored.snapshot),
        snapshot: stored.snapshot,
        operations: [...stored.operations],
        clients: new Map<string, string>(),
      }
    }
    this.documents.set(payload.documentId, document)
    document.clients.set(socket.id, payload.clientId)
    socket.data.documentId = payload.documentId
    socket.data.clientId = payload.clientId
    socket.data.cursor = { index: 0 }
    await socket.join(roomFor(payload.documentId))

    const state: DocumentState = {
      snapshot: document.snapshot,
      operations: [...document.operations],
      presence: this.presenceFor(document),
    }
    socket.emit('document-state', state)
    this.broadcastPresence(payload.documentId, document)
  }

  private async receiveOperation(
    socket: CollaborationSocket,
    payload: OperationPayload,
  ): Promise<void> {
    const documentId = socket.data.documentId
    if (!isNonEmptyString(documentId) || payload.documentId !== documentId) {
      socket.emit('room-error', {
        message: 'Join the document before sending operations',
      })
      return
    }

    const document = this.documents.get(documentId)
    if (!document) return

    const key = operationKey(payload.operation)
    if (
      document.operations.some(
        (operation) => operationKey(operation) === key,
      ) ||
      document.crdt.hasElement(payload.operation.id) ||
      document.crdt.isDeleted(payload.operation.id)
    ) {
      socket.emit('operation-ack', payload.operation.id)
      return
    }

    document.crdt.apply(payload.operation)
    const result = await this.store.append(
      documentId,
      payload.operation,
      document.crdt.snapshot(),
    )
    if (!result.accepted) {
      socket.emit('operation-ack', payload.operation.id)
      return
    }

    document.operations.push(payload.operation)
    if (result.compacted) {
      document.snapshot = document.crdt.snapshot()
      document.operations.length = 0
    }
    this.io.to(roomFor(documentId)).emit('operation', payload.operation)
    socket.emit('operation-ack', payload.operation.id)
  }

  private leaveDocument(socket: CollaborationSocket): void {
    const documentId = socket.data.documentId
    if (!isNonEmptyString(documentId)) return

    const document = this.documents.get(documentId)
    if (!document) return

    document.clients.delete(socket.id)
    void socket.leave(roomFor(documentId))
    delete socket.data.documentId
    delete socket.data.clientId
    delete socket.data.cursor
    this.broadcastPresence(documentId, document)
  }

  private updateCursor(
    socket: CollaborationSocket,
    cursor: CursorPosition,
  ): void {
    const documentId = socket.data.documentId
    if (!isNonEmptyString(documentId) || !Number.isInteger(cursor.index)) return

    const document = this.documents.get(documentId)
    if (!document) return

    socket.data.cursor = { index: Math.max(0, cursor.index) }
    this.broadcastPresence(documentId, document)
  }

  private broadcastPresence(
    documentId: string,
    document: DocumentSession,
  ): void {
    this.io.to(roomFor(documentId)).emit('presence', this.presenceFor(document))
  }

  private presenceFor(document: DocumentSession): PresenceMember[] {
    return [...document.clients.entries()]
      .map(([socketId, clientId]) => {
        const cursor = this.io.sockets.sockets.get(socketId)?.data.cursor
        return cursor ? { clientId, cursor } : { clientId }
      })
      .sort((left, right) => left.clientId.localeCompare(right.clientId))
  }
}
