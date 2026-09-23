import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  ROOT_ID,
  SequenceCrdt,
  type ClientToServerEvents,
  type HealthResponse,
  type Operation,
  type PresenceMember,
  type ServerToClientEvents,
} from '@crdt-editor/shared'

const documentId = 'demo-document'

const createSiteId = (): string => `site-${crypto.randomUUID().slice(0, 8)}`

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [documentText, setDocumentText] = useState('')
  const [presence, setPresence] = useState<readonly PresenceMember[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [siteId] = useState(createSiteId)
  const socketRef = useRef<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null)
  const crdtRef = useRef(new SequenceCrdt())
  const clockRef = useRef(0)
  const previousTextRef = useRef('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pendingOperationsRef = useRef(new Map<string, Operation>())
  const syncReadyRef = useRef(false)

  useEffect(() => {
    void fetch('/health')
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Health check failed with status ${response.status}`)
        return (await response.json()) as HealthResponse
      })
      .then(setHealth)
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unknown error',
        )
      })
  }, [])

  useEffect(() => {
    const socket = io() as Socket<ServerToClientEvents, ClientToServerEvents>
    socketRef.current = socket

    const updateText = () => {
      const text = crdtRef.current.toString()
      previousTextRef.current = text
      setDocumentText(text)
    }

    const sendPendingOperations = () => {
      if (!syncReadyRef.current || !socket.connected) return
      for (const operation of pendingOperationsRef.current.values()) {
        socket.emit('operation', { documentId, operation })
      }
    }

    socket.on('connect', () => {
      setConnectionStatus('connected')
      syncReadyRef.current = false
      socket.emit('join-document', { documentId, clientId: siteId })
    })
    socket.on('disconnect', () => {
      syncReadyRef.current = false
      setConnectionStatus('disconnected')
    })
    socket.on('connect_error', () => setConnectionStatus('unavailable'))
    socket.on('document-state', (state) => {
      crdtRef.current = SequenceCrdt.fromSnapshot(state.snapshot)
      crdtRef.current.applyAll(state.operations)
      for (const operation of pendingOperationsRef.current.values()) {
        crdtRef.current.apply(operation)
      }
      setPresence(state.presence)
      updateText()
      syncReadyRef.current = true
      sendPendingOperations()
    })
    socket.on('operation', (operation) => {
      crdtRef.current.apply(operation)
      updateText()
    })
    socket.on('operation-ack', (id) => {
      pendingOperationsRef.current.delete(`${id.siteId}\u0000${id.clock}`)
      setPendingCount(pendingOperationsRef.current.size)
    })
    socket.on('presence', setPresence)
    socket.on('room-error', ({ message }) => setError(message))

    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [siteId])

  const applyLocalText = (nextText: string): void => {
    const previousText = previousTextRef.current
    let prefix = 0
    while (
      prefix < previousText.length &&
      previousText[prefix] === nextText[prefix]
    )
      prefix += 1

    let suffix = 0
    while (
      suffix < previousText.length - prefix &&
      suffix < nextText.length - prefix &&
      previousText[previousText.length - suffix - 1] ===
        nextText[nextText.length - suffix - 1]
    )
      suffix += 1

    const deletedCount = previousText.length - prefix - suffix
    const insertedText = nextText.slice(
      prefix,
      nextText.length - suffix || undefined,
    )
    const visibleElements = crdtRef.current.visibleElements()
    const socket = socketRef.current

    const queueOperation = (operation: Operation): void => {
      pendingOperationsRef.current.set(
        `${operation.id.siteId}\u0000${operation.id.clock}`,
        operation,
      )
      setPendingCount(pendingOperationsRef.current.size)
      if (socket && syncReadyRef.current && socket.connected) {
        socket.emit('operation', { documentId, operation })
      }
    }

    for (const element of visibleElements.slice(
      prefix,
      prefix + deletedCount,
    )) {
      const operation = { type: 'delete' as const, id: element.id }
      crdtRef.current.apply(operation)
      queueOperation(operation)
    }

    let predecessor = visibleElements[prefix - 1]?.id ?? ROOT_ID
    for (const value of insertedText) {
      const operation = {
        type: 'insert' as const,
        id: { siteId, clock: ++clockRef.current },
        after: predecessor,
        value,
      }
      crdtRef.current.apply(operation)
      queueOperation(operation)
      predecessor = operation.id
    }

    previousTextRef.current = nextText
    setDocumentText(nextText)
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(
        prefix + insertedText.length,
        prefix + insertedText.length,
      )
    })
  }

  const updateCursor = (): void => {
    const index = textareaRef.current?.selectionStart ?? 0
    socketRef.current?.emit('update-cursor', { index })
  }

  const remoteMembers = presence.filter((member) => member.clientId !== siteId)

  return (
    <main className="editor-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CRDT Editor / document 01</p>
          <h1>Field notes</h1>
        </div>
        <div className={`connection connection-${connectionStatus}`}>
          <span className="connection-dot" /> {connectionStatus}
        </div>
      </header>
      <section className="workspace" aria-label="Collaborative editor">
        <div className="editor-panel">
          <div className="panel-meta">
            <span>Shared document</span>
            <span>{documentText.length} characters</span>
          </div>
          <textarea
            ref={textareaRef}
            aria-label="Shared document text"
            value={documentText}
            onChange={(event) => applyLocalText(event.target.value)}
            onSelect={updateCursor}
            onClick={updateCursor}
            onKeyUp={updateCursor}
            placeholder="Start writing together..."
            spellCheck
          />
          <div className="editor-footer">
            <span>{health ? 'Server ready' : 'Checking server...'}</span>
            <span>
              {pendingCount > 0
                ? `${pendingCount} pending edit${pendingCount === 1 ? '' : 's'}`
                : `${remoteMembers.length} other editor`}
              {remoteMembers.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <aside className="presence-panel" aria-label="Collaborators">
          <div className="panel-meta">
            <span>In the room</span>
            <span>{presence.length}</span>
          </div>
          <div className="member-list">
            {presence.map((member) => (
              <div className="member" key={member.clientId}>
                <span className="member-swatch" />
                <span className="member-name">
                  {member.clientId === siteId ? 'You' : member.clientId}
                </span>
                <span className="member-position">
                  {member.cursor?.index ?? 0}
                </span>
              </div>
            ))}
          </div>
          {remoteMembers.length > 0 && (
            <div className="cursor-rail" aria-label="Remote cursor positions">
              {remoteMembers.map((member, index) => (
                <span
                  className="cursor-marker"
                  key={member.clientId}
                  style={{
                    left: `${Math.min(100, (100 * (member.cursor?.index ?? 0)) / Math.max(documentText.length, 1))}%`,
                    top: `${index * 1.5}rem`,
                  }}
                  title={`${member.clientId} cursor`}
                />
              ))}
            </div>
          )}
        </aside>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}

export default App
