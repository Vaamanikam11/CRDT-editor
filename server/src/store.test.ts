import { describe, expect, it } from 'vitest'
import {
  ROOT_ID,
  SequenceCrdt,
  type InsertOperation,
} from '@crdt-editor/shared'
import { MemoryOperationStore } from './store.js'

const operation = (
  siteId: string,
  clock: number,
  after = ROOT_ID,
  value = siteId,
): InsertOperation => ({
  type: 'insert',
  id: { siteId, clock },
  after,
  value,
})

describe('MemoryOperationStore', () => {
  it('replays operations and compacts them into a CRDT snapshot', async () => {
    const store = new MemoryOperationStore(2)
    const first = operation('site-a', 1, ROOT_ID, 'A')
    const second = operation('site-a', 2, first.id, 'B')
    const crdt = new SequenceCrdt()

    crdt.apply(first)
    expect(await store.append('document', first, crdt.snapshot())).toEqual({
      accepted: true,
      compacted: false,
    })
    crdt.apply(second)
    expect(await store.append('document', second, crdt.snapshot())).toEqual({
      accepted: true,
      compacted: true,
    })

    const stored = await store.load('document')
    expect(stored.operations).toEqual([])
    expect(SequenceCrdt.fromSnapshot(stored.snapshot).toString()).toBe('AB')
  })

  it('rejects duplicate operation IDs', async () => {
    const store = new MemoryOperationStore()
    const first = operation('site-a', 1)
    const snapshot = new SequenceCrdt().snapshot()

    expect(await store.append('document', first, snapshot)).toEqual({
      accepted: true,
      compacted: false,
    })
    expect(await store.append('document', first, snapshot)).toEqual({
      accepted: false,
      compacted: false,
    })
  })
})
