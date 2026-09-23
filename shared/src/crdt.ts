export interface ElementId {
  readonly siteId: string
  readonly clock: number
}

export interface InsertOperation {
  readonly type: 'insert'
  readonly id: ElementId
  readonly after: ElementId
  readonly value: string
}

export interface DeleteOperation {
  readonly type: 'delete'
  readonly id: ElementId
}

export type Operation = InsertOperation | DeleteOperation

export const ROOT_ID: ElementId = Object.freeze({ siteId: '', clock: 0 })

export interface CrdtElement {
  readonly id: ElementId
  readonly after: ElementId
  readonly value: string
}

export interface CrdtSnapshot {
  readonly elements: readonly CrdtElement[]
  readonly tombstones: readonly ElementId[]
}

const keyOf = (id: ElementId): string => `${id.siteId}\u0000${id.clock}`

const compareIds = (left: ElementId, right: ElementId): number => {
  if (left.siteId < right.siteId) return -1
  if (left.siteId > right.siteId) return 1
  return left.clock - right.clock
}

export class SequenceCrdt {
  private readonly elements = new Map<string, CrdtElement>()
  private readonly children = new Map<string, Set<string>>()
  private readonly tombstones = new Set<string>()

  apply(operation: Operation): void {
    if (operation.type === 'delete') {
      this.tombstones.add(keyOf(operation.id))
      return
    }

    const elementKey = keyOf(operation.id)
    if (this.elements.has(elementKey)) return

    this.elements.set(elementKey, {
      id: operation.id,
      after: operation.after,
      value: operation.value,
    })

    const predecessorKey = keyOf(operation.after)
    const siblings = this.children.get(predecessorKey) ?? new Set<string>()
    siblings.add(elementKey)
    this.children.set(predecessorKey, siblings)
  }

  applyAll(operations: readonly Operation[]): void {
    for (const operation of operations) this.apply(operation)
  }

  static fromSnapshot(snapshot: CrdtSnapshot): SequenceCrdt {
    const crdt = new SequenceCrdt()

    for (const element of snapshot.elements) {
      crdt.apply({
        type: 'insert',
        id: element.id,
        after: element.after,
        value: element.value,
      })
    }

    for (const tombstone of snapshot.tombstones) {
      crdt.apply({ type: 'delete', id: tombstone })
    }

    return crdt
  }

  snapshot(): CrdtSnapshot {
    return {
      elements: [...this.elements.values()],
      tombstones: [...this.tombstones].map((elementKey) => {
        const element = this.elements.get(elementKey)
        if (element) return element.id

        const [siteId, clock] = elementKey.split('\u0000')
        return { siteId: siteId ?? '', clock: Number(clock) }
      }),
    }
  }

  toString(): string {
    return this.visibleElements()
      .map((element) => element.value)
      .join('')
  }

  visibleElements(): CrdtElement[] {
    const visible: CrdtElement[] = []
    this.walk(ROOT_ID, visible)
    return visible
  }

  hasElement(id: ElementId): boolean {
    return this.elements.has(keyOf(id))
  }

  isDeleted(id: ElementId): boolean {
    return this.tombstones.has(keyOf(id))
  }

  private walk(predecessor: ElementId, visible: CrdtElement[]): void {
    const childKeys = this.children.get(keyOf(predecessor))
    if (!childKeys) return

    const childElements = [...childKeys]
      .map((childKey) => this.elements.get(childKey))
      .filter((element): element is CrdtElement => element !== undefined)
      .sort((left, right) => compareIds(left.id, right.id))

    for (const element of childElements) {
      if (!this.tombstones.has(keyOf(element.id))) visible.push(element)
      this.walk(element.id, visible)
    }
  }
}
