export type MemoryOperation =
  | { action: 'add'; project: string; text: string }
  | { action: 'update'; memoryId: string; text: string }

const OPERATION_KEYS = new Map([
  ['add', new Set(['action', 'project', 'text'])],
  ['update', new Set(['action', 'memoryID', 'text'])]
])
const memoryIdKey = 'memoryID' as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isValidText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

type OperationInput = Record<string, unknown> & {
  action: string
  text: string
}

function validateOperationInput(value: unknown): asserts value is OperationInput {
  if (!isRecord(value)) {
    throw new Error('Memory extractor returned an invalid operation')
  }

  const { action, text } = value
  if (typeof action !== 'string' || !isValidText(text)) {
    throw new Error('Memory extractor returned an invalid operation shape')
  }
}

function isKnownMemoryId(value: unknown, memoryIds: ReadonlySet<string>): value is string {
  return typeof value === 'string' && memoryIds.has(value)
}

function hasAllowedKeys(input: OperationInput): boolean {
  const allowedKeys = OPERATION_KEYS.get(input.action)
  return allowedKeys !== undefined && Object.keys(input).every((key) => allowedKeys.has(key))
}

function parseAdd(value: OperationInput, candidates: ReadonlySet<string>): MemoryOperation {
  if (typeof value.project !== 'string' || !candidates.has(value.project)) {
    throw new Error('Memory extractor returned an unknown project')
  }

  return { action: 'add', project: value.project, text: value.text.trim() }
}

function parseOperation(
  value: unknown,
  memoryIds: ReadonlySet<string>,
  candidates: ReadonlySet<string>
): MemoryOperation {
  validateOperationInput(value)
  if (!hasAllowedKeys(value)) {
    throw new Error('Memory extractor returned an unknown or untrusted memory ID')
  }

  if (value.action === 'add') {
    return parseAdd(value, candidates)
  }

  const memoryId = value[memoryIdKey]
  if (!isKnownMemoryId(memoryId, memoryIds)) {
    throw new Error('Memory extractor returned an unknown or untrusted memory ID')
  }

  return { action: 'update', memoryId, text: value.text.trim() }
}

export function parseOperations(
  value: string,
  memoryIds: ReadonlySet<string>,
  candidates: ReadonlySet<string>
): MemoryOperation[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) {
    throw new TypeError('Memory extractor did not return an array')
  }

  return parsed.map((item) => parseOperation(item, memoryIds, candidates))
}
