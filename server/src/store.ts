import { Pool, type PoolConfig } from 'pg'
import type { CrdtSnapshot, Operation } from '@crdt-editor/shared'

export interface StoredDocument {
  readonly snapshot: CrdtSnapshot
  readonly operations: readonly Operation[]
}

export interface OperationStore {
  initialize(): Promise<void>
  load(documentId: string): Promise<StoredDocument>
  append(
    documentId: string,
    operation: Operation,
    snapshot: CrdtSnapshot,
  ): Promise<AppendResult>
  close(): Promise<void>
}

export interface AppendResult {
  readonly accepted: boolean
  readonly compacted: boolean
}

const emptySnapshot = (): CrdtSnapshot => ({ elements: [], tombstones: [] })
const operationKey = (operation: Operation): string =>
  `${operation.id.siteId}\u0000${operation.id.clock}`

export class MemoryOperationStore implements OperationStore {
  private readonly documents = new Map<
    string,
    { snapshot: CrdtSnapshot; operations: Operation[]; seen: Set<string> }
  >()

  constructor(private readonly snapshotInterval = 100) {}

  async initialize(): Promise<void> {}

  async load(documentId: string): Promise<StoredDocument> {
    const document = this.documents.get(documentId)
    if (!document) return { snapshot: emptySnapshot(), operations: [] }

    return {
      snapshot: document.snapshot,
      operations: [...document.operations],
    }
  }

  async append(
    documentId: string,
    operation: Operation,
    snapshot: CrdtSnapshot,
  ): Promise<AppendResult> {
    const document = this.documents.get(documentId) ?? {
      snapshot: emptySnapshot(),
      operations: [],
      seen: new Set<string>(),
    }
    if (document.seen.has(operationKey(operation))) {
      this.documents.set(documentId, document)
      return { accepted: false, compacted: false }
    }

    document.seen.add(operationKey(operation))
    document.operations.push(operation)
    const compacted = document.operations.length >= this.snapshotInterval
    if (compacted) {
      document.snapshot = snapshot
      document.operations.length = 0
    }
    this.documents.set(documentId, document)
    return { accepted: true, compacted }
  }

  async close(): Promise<void> {}
}

export class PostgresOperationStore implements OperationStore {
  private readonly pool: Pool

  constructor(
    config: PoolConfig = {
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://crdt:crdt@localhost:5432/crdt_editor',
    },
    private readonly snapshotInterval = 100,
  ) {
    this.pool = new Pool(config)
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS document_snapshots (
        document_id TEXT PRIMARY KEY,
        snapshot JSONB NOT NULL,
        operations_since_snapshot INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS document_operations (
        document_id TEXT NOT NULL REFERENCES document_snapshots(document_id) ON DELETE CASCADE,
        site_id TEXT NOT NULL,
        logical_clock INTEGER NOT NULL,
        operation JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (document_id, site_id, logical_clock)
      );

      CREATE INDEX IF NOT EXISTS document_operations_order_idx
        ON document_operations (document_id, created_at, site_id, logical_clock);
    `)
  }

  async load(documentId: string): Promise<StoredDocument> {
    await this.pool.query(
      `INSERT INTO document_snapshots (document_id, snapshot)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (document_id) DO NOTHING`,
      [documentId, JSON.stringify(emptySnapshot())],
    )

    const result = await this.pool.query<{
      snapshot: CrdtSnapshot
      operation: Operation
    }>(
      `SELECT snapshots.snapshot, operations.operation
       FROM document_snapshots snapshots
       LEFT JOIN document_operations operations
         ON operations.document_id = snapshots.document_id
       WHERE snapshots.document_id = $1
       ORDER BY operations.created_at ASC NULLS FIRST,
                operations.site_id ASC NULLS FIRST,
                operations.logical_clock ASC NULLS FIRST`,
      [documentId],
    )

    const firstRow = result.rows[0]
    return {
      snapshot: firstRow?.snapshot ?? emptySnapshot(),
      operations: result.rows.flatMap((row) =>
        row.operation ? [row.operation] : [],
      ),
    }
  }

  async append(
    documentId: string,
    operation: Operation,
    snapshot: CrdtSnapshot,
  ): Promise<AppendResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO document_snapshots (document_id, snapshot)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (document_id) DO NOTHING`,
        [documentId, JSON.stringify(emptySnapshot())],
      )
      const inserted = await client.query(
        `INSERT INTO document_operations
           (document_id, site_id, logical_clock, operation)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (document_id, site_id, logical_clock) DO NOTHING`,
        [
          documentId,
          operation.id.siteId,
          operation.id.clock,
          JSON.stringify(operation),
        ],
      )

      if (inserted.rowCount !== 1) {
        await client.query('ROLLBACK')
        return { accepted: false, compacted: false }
      }

      const countResult = await client.query<{
        operations_since_snapshot: number
      }>(
        `SELECT operations_since_snapshot
         FROM document_snapshots
         WHERE document_id = $1
         FOR UPDATE`,
        [documentId],
      )
      const count = (countResult.rows[0]?.operations_since_snapshot ?? 0) + 1

      if (count >= this.snapshotInterval) {
        await client.query(
          `UPDATE document_snapshots
           SET snapshot = $2::jsonb, operations_since_snapshot = 0, updated_at = NOW()
           WHERE document_id = $1`,
          [documentId, JSON.stringify(snapshot)],
        )
        await client.query(
          'DELETE FROM document_operations WHERE document_id = $1',
          [documentId],
        )
      } else {
        await client.query(
          `UPDATE document_snapshots
           SET operations_since_snapshot = $2, updated_at = NOW()
           WHERE document_id = $1`,
          [documentId, count],
        )
      }

      await client.query('COMMIT')
      return { accepted: true, compacted: count >= this.snapshotInterval }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
