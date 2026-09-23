import { describe, expect, it } from 'vitest'
import {
  ROOT_ID,
  SequenceCrdt,
  type ElementId,
  type InsertOperation,
  type Operation,
} from './crdt.js'

const id = (siteId: string, clock: number): ElementId => ({ siteId, clock })

const insert = (
  elementId: ElementId,
  after: ElementId,
  value: string,
): InsertOperation => ({
  type: 'insert',
  id: elementId,
  after,
  value,
})

const permutations = <Value>(values: readonly Value[]): Value[][] => {
  if (values.length === 0) return [[]]

  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(
      (rest) => [value, ...rest],
    ),
  )
}

describe('SequenceCrdt', () => {
  it('inserts and deletes text while retaining tombstones', () => {
    const first = id('site-a', 1)
    const second = id('site-a', 2)
    const crdt = new SequenceCrdt()

    crdt.applyAll([
      insert(first, ROOT_ID, 'h'),
      insert(second, first, 'i'),
      { type: 'delete', id: first },
    ])

    expect(crdt.toString()).toBe('i')
    expect(crdt.hasElement(first)).toBe(true)
    expect(crdt.isDeleted(first)).toBe(true)
  })

  it('handles a delete that arrives before its insert', () => {
    const element = id('site-a', 1)
    const crdt = new SequenceCrdt()

    crdt.apply({ type: 'delete', id: element })
    crdt.apply(insert(element, ROOT_ID, 'x'))

    expect(crdt.toString()).toBe('')
    expect(crdt.hasElement(element)).toBe(true)
  })

  it('is idempotent when an operation is delivered more than once', () => {
    const operation = insert(id('site-a', 1), ROOT_ID, 'x')
    const crdt = new SequenceCrdt()

    crdt.apply(operation)
    crdt.apply(operation)

    expect(crdt.toString()).toBe('x')
    expect(crdt.visibleElements()).toHaveLength(1)
  })

  it('converges for every delivery order of concurrent operations', () => {
    const first = id('site-a', 1)
    const second = id('site-b', 1)
    const firstChild = id('site-a', 2)
    const secondChild = id('site-b', 2)
    const operations: Operation[] = [
      insert(first, ROOT_ID, 'A'),
      insert(second, ROOT_ID, 'B'),
      insert(firstChild, first, 'a'),
      insert(secondChild, second, 'b'),
      { type: 'delete', id: first },
    ]

    const results = new Set(
      permutations(operations).map((deliveryOrder) => {
        const crdt = new SequenceCrdt()
        crdt.applyAll(deliveryOrder)
        return crdt.toString()
      }),
    )

    expect(results).toEqual(new Set(['aBb']))
  })
})
