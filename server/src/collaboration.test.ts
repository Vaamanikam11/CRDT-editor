import { createServer, type Server as HttpServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import {
  ROOT_ID,
  type ClientToServerEvents,
  type DocumentState,
  type Operation,
  type ServerToClientEvents,
} from '@crdt-editor/shared'
import { createApp } from './app.js'
import { CollaborationServer } from './collaboration.js'

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>

const clients: TestSocket[] = []
let httpServer: HttpServer | undefined
let collaboration: CollaborationServer | undefined

const waitForListening = (server: HttpServer): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('Server did not expose a port')
      resolve(address.port)
    })
  })

const waitForEvent = <EventName extends keyof ServerToClientEvents>(
  socket: TestSocket,
  event: EventName,
): Promise<Parameters<ServerToClientEvents[EventName]>[0]> =>
  new Promise((resolve) => {
    socket.once(event, ((value: unknown) =>
      resolve(
        value as Parameters<ServerToClientEvents[EventName]>[0],
      )) as never)
  })

const waitForPresenceCount = (
  socket: TestSocket,
  count: number,
): Promise<readonly { readonly clientId: string }[]> =>
  new Promise((resolve) => {
    const listener = (members: readonly { readonly clientId: string }[]) => {
      if (members.length !== count) return
      socket.off('presence', listener)
      resolve(members)
    }
    socket.on('presence', listener)
  })

const connectClient = async (
  port: number,
  clientId: string,
): Promise<{ socket: TestSocket; state: Promise<DocumentState> }> => {
  const socket = io(`http://localhost:${port}`, {
    autoConnect: false,
  }) as Socket<ServerToClientEvents, ClientToServerEvents>
  clients.push(socket)
  const connected = new Promise<void>((resolve) =>
    socket.once('connect', resolve),
  )
  const state = waitForEvent(socket, 'document-state')
  socket.connect()
  await connected
  socket.emit('join-document', { documentId: 'test-document', clientId })
  return { socket, state }
}

afterEach(async () => {
  for (const client of clients) client.close()
  clients.length = 0
  await collaboration?.close()
  await new Promise<void>((resolve) => httpServer?.close(() => resolve()))
  collaboration = undefined
  httpServer = undefined
})

describe('CollaborationServer', () => {
  it('bootstraps document state, broadcasts operations, and tracks presence', async () => {
    httpServer = createServer(createApp())
    collaboration = new CollaborationServer(httpServer)
    const port = await waitForListening(httpServer)

    const firstClient = await connectClient(port, 'site-a')
    const first = firstClient.socket
    const firstState = await firstClient.state
    expect(firstState).toEqual({
      snapshot: { elements: [], tombstones: [] },
      operations: [],
      presence: [{ clientId: 'site-a', cursor: { index: 0 } }],
    } satisfies DocumentState)

    const secondPresence = waitForPresenceCount(first, 2)
    const secondClient = await connectClient(port, 'site-b')
    const second = secondClient.socket
    await secondClient.state
    expect(await secondPresence).toEqual([
      { clientId: 'site-a', cursor: { index: 0 } },
      { clientId: 'site-b', cursor: { index: 0 } },
    ])

    const cursorUpdate = waitForEvent(first, 'presence')
    second.emit('update-cursor', { index: 4 })
    expect(await cursorUpdate).toEqual([
      { clientId: 'site-a', cursor: { index: 0 } },
      { clientId: 'site-b', cursor: { index: 4 } },
    ])

    const operation: Operation = {
      type: 'insert',
      id: { siteId: 'site-a', clock: 1 },
      after: ROOT_ID,
      value: 'H',
    }
    const firstOperation = waitForEvent(first, 'operation')
    const secondOperation = waitForEvent(second, 'operation')
    const operationAck = waitForEvent(first, 'operation-ack')
    first.emit('operation', { documentId: 'test-document', operation })
    expect(await firstOperation).toEqual(operation)
    expect(await secondOperation).toEqual(operation)
    expect(await operationAck).toEqual(operation.id)

    const departedPresence = waitForEvent(first, 'presence')
    second.close()
    expect(await departedPresence).toEqual([
      { clientId: 'site-a', cursor: { index: 0 } },
    ])
  })
})
