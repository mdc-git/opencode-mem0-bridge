import type { Plugin } from '@opencode/plugin'
import type { Model } from '@opencode/schema/model'
import type { Mem0Tools } from './mem0-tools.ts'
import {
  buildEvidence,
  buildExtractionPrompt,
  buildSearchQuery,
  type TerminalOutcome
} from './automatic-memory.ts'
import { parseOperations, type MemoryOperation } from './memory-operations.ts'

export type ModelRef = Model.Ref

type Session = {
  id: string
  agent?: string
  model?: ModelRef
}

type RunnerOptions = {
  ctx: Plugin.Context
  mem0: Mem0Tools
  controller: AbortController
  extractionModel?: ModelRef
  limit: number
}

type Execution = {
  sessionId: string
  outcome: TerminalOutcome
  idleId: string
}

const sessionIdKey = 'sessionID' as const
const executionOutcomes = new Map<string, TerminalOutcome>([
  ['session.execution.succeeded', 'succeeded'],
  ['session.execution.failed', 'failed'],
  ['session.execution.interrupted', 'interrupted']
])

function eventData(event: {
  type: string
  id: string
  data: unknown
}): Record<string, unknown> | undefined {
  if (event.data === null || typeof event.data !== 'object') {
    return undefined
  }

  return event.data as Record<string, unknown>
}

function executionOutcome(
  type: string,
  data: Record<string, unknown>
): TerminalOutcome | undefined {
  const outcome = executionOutcomes.get(type)
  if (outcome === undefined) {
    return undefined
  }

  return outcome === 'interrupted' && data.reason === 'shutdown' ? undefined : outcome
}

function eventIdleId(id: string): string {
  return id.startsWith('evt_') ? `msg_${id.slice(4)}` : id
}

function eventExecution(event: { type: string; id: string; data: unknown }): Execution | undefined {
  const data = eventData(event)
  if (data === undefined) {
    return undefined
  }

  const sessionId = data[sessionIdKey]
  if (typeof sessionId !== 'string') {
    return undefined
  }

  const outcome = executionOutcome(event.type, data)
  if (outcome === undefined) {
    return undefined
  }

  return { sessionId, outcome, idleId: eventIdleId(event.id) }
}

async function writeOperation(
  mem0: Mem0Tools,
  session: Session,
  operation: MemoryOperation
): Promise<void> {
  if (operation.action === 'add') {
    await mem0.add(session, operation.text)
    return
  }

  await mem0.update(session, operation.memoryId, operation.text)
}

async function writeOperations(
  mem0: Mem0Tools,
  session: Session,
  operations: readonly MemoryOperation[]
): Promise<void> {
  let pending = Promise.resolve()
  for (const operation of operations) {
    pending = pending.then(async () => writeOperation(mem0, session, operation))
  }

  await pending
}

async function processExecution(
  options: RunnerOptions,
  sessionId: string,
  outcome: TerminalOutcome,
  idleId: string
): Promise<void> {
  const { controller, ctx, mem0 } = options
  const session = (await ctx.session.get(
    { [sessionIdKey]: sessionId },
    { signal: controller.signal }
  )) as Session
  const messages = await ctx.session.context(
    { [sessionIdKey]: sessionId },
    { signal: controller.signal }
  )
  const items = buildEvidence(messages, outcome, idleId)
  const searchQuery = buildSearchQuery(items)
  if (searchQuery === '') {
    return
  }

  const memories = await mem0.search(session, searchQuery, options.limit)
  const prompt = buildExtractionPrompt(items, memories, outcome)
  const model = options.extractionModel ?? session.model
  const generated = await ctx.generate.text(
    {
      prompt,
      ...(model !== undefined && { model })
    },
    { signal: controller.signal }
  )
  const operations = parseOperations(generated.text, new Set(memories.map((memory) => memory.id)))
  await writeOperations(mem0, session, operations)
}

function enqueueExecution(
  queue: Map<string, Promise<void>>,
  options: RunnerOptions,
  execution: Execution
): void {
  const previous = queue.get(execution.sessionId) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () =>
      processExecution(options, execution.sessionId, execution.outcome, execution.idleId)
    )
    .catch(() => undefined)
  queue.set(execution.sessionId, next)
  void next.finally(() => {
    if (queue.get(execution.sessionId) === next) {
      queue.delete(execution.sessionId)
    }
  })
}

export async function automaticMemory(options: RunnerOptions): Promise<void> {
  const queue = new Map<string, Promise<void>>()

  try {
    for await (const event of options.ctx.event.subscribe({
      signal: options.controller.signal
    })) {
      const execution = eventExecution(event)
      if (execution !== undefined) {
        enqueueExecution(queue, options, execution)
      }
    }
  } catch {
    // Cleanup aborts the event stream. Extraction is intentionally best effort.
  } finally {
    await Promise.all(queue.values())
  }
}
