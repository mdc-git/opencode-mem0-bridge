export type MemoryOperation =
  { action: 'add'; text: string } | { action: 'update'; memoryId: string; text: string }

const ADD_KEYS = new Set(['action', 'text'])
const UPDATE_KEYS = new Set(['action', 'memoryID', 'text'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isValidText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function hasUnknownKey(keys: readonly string[], allowed: ReadonlySet<string>): boolean {
  return keys.some((key) => !allowed.has(key))
}

function isKnownMemoryId(value: unknown, memoryIds: ReadonlySet<string>): value is string {
  return typeof value === 'string' && memoryIds.has(value)
}

function parseAddOperation(
  action: string,
  text: string,
  keys: readonly string[]
): MemoryOperation | undefined {
  if (action !== 'add') {
    return undefined
  }

  if (keys.some((key) => !ADD_KEYS.has(key))) {
    return undefined
  }

  return { action: 'add', text: text.trim() }
}

type UpdateInput = {
  action: string
  text: string
  value: Record<string, unknown>
  keys: readonly string[]
  memoryIds: ReadonlySet<string>
}

function parseUpdateOperation(input: UpdateInput): MemoryOperation | undefined {
  if (input.action !== 'update') {
    return undefined
  }

  if (hasUnknownKey(input.keys, UPDATE_KEYS)) {
    return undefined
  }

  const memoryId = input.value.memoryID
  if (!isKnownMemoryId(memoryId, input.memoryIds)) {
    return undefined
  }

  return { action: 'update', memoryId, text: input.text.trim() }
}

type OperationInput = {
  action: string
  text: string
  value: Record<string, unknown>
  keys: string[]
}

function operationInput(value: unknown): OperationInput {
  if (!isRecord(value)) {
    throw new Error('Memory extractor returned an invalid operation')
  }

  const { action, text } = value
  if (typeof action !== 'string' || !isValidText(text)) {
    throw new Error('Memory extractor returned an invalid operation shape')
  }

  return { action, text, value, keys: Object.keys(value) }
}

function parseOperation(value: unknown, memoryIds: ReadonlySet<string>): MemoryOperation {
  const input = operationInput(value)
  const add = parseAddOperation(input.action, input.text, input.keys)
  if (add !== undefined) {
    return add
  }

  const update = parseUpdateOperation({ ...input, memoryIds })
  if (update !== undefined) {
    return update
  }

  throw new Error('Memory extractor returned an unknown or untrusted memory ID')
}

export function parseOperations(value: string, memoryIds: ReadonlySet<string>): MemoryOperation[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) {
    throw new TypeError('Memory extractor did not return an array')
  }

  return parsed.map((item) => parseOperation(item, memoryIds))
}
