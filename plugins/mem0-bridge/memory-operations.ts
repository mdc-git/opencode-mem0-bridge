type MemoryOperation =
  { action: 'add'; text: string } | { action: 'update'; memoryId: string; text: string }

const OPERATION_KEYS = new Map([
  ['add', new Set(['action', 'text'])],
  ['update', new Set(['action', 'memoryID', 'text'])]
])
const memoryIdKey = 'memoryID' as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isValidText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

type OperationInput = {
  action: string
  text: string
  value: Record<string, unknown>
}

function operationInput(value: unknown): OperationInput {
  if (!isRecord(value)) {
    throw new Error('Memory extractor returned an invalid operation')
  }

  const { action, text } = value
  if (typeof action !== 'string' || !isValidText(text)) {
    throw new Error('Memory extractor returned an invalid operation shape')
  }

  return { action, text, value }
}

function isKnownMemoryId(value: unknown, memoryIds: ReadonlySet<string>): value is string {
  return typeof value === 'string' && memoryIds.has(value)
}

function hasAllowedKeys(input: OperationInput): boolean {
  const allowedKeys = OPERATION_KEYS.get(input.action)
  return allowedKeys !== undefined && Object.keys(input.value).every((key) => allowedKeys.has(key))
}

function parseOperation(value: unknown, memoryIds: ReadonlySet<string>): MemoryOperation {
  const input = operationInput(value)
  if (!hasAllowedKeys(input)) {
    throw new Error('Memory extractor returned an unknown or untrusted memory ID')
  }

  if (input.action === 'add') {
    return { action: 'add', text: input.text.trim() }
  }

  const memoryId = input.value[memoryIdKey]
  if (!isKnownMemoryId(memoryId, memoryIds)) {
    throw new Error('Memory extractor returned an unknown or untrusted memory ID')
  }

  return { action: 'update', memoryId, text: input.text.trim() }
}

export function parseOperations(value: string, memoryIds: ReadonlySet<string>): MemoryOperation[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) {
    throw new TypeError('Memory extractor did not return an array')
  }

  return parsed.map((item) => parseOperation(item, memoryIds))
}
