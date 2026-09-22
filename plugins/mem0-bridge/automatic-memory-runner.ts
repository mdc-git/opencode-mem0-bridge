import type { Model, Plugin } from '@opencode/plugin'
import type { Mem0Tools } from './mem0-tools.ts'
import {
  buildEvidence,
  buildExtractionPrompt,
  buildSearchQuery,
  type TerminalOutcome
} from './automatic-memory.ts'
import { parseOperations } from './memory-operations.ts'

type RunnerOptions = {
  ctx: Plugin.Context
  mem0: Mem0Tools
  signal: AbortSignal
  extractionModel?: Model.Ref
  limit: number
}

type Execution = {
  sessionId: string
  outcome: TerminalOutcome
  idleId: string
}

type OpenCodeEvent =
  ReturnType<Plugin.Context['event']['subscribe']> extends AsyncIterable<infer Event>
    ? Event
    : never

type ExecutionEvent = Extract<
  OpenCodeEvent,
  {
    type:
      'session.execution.succeeded' | 'session.execution.failed' | 'session.execution.interrupted'
  }
>

const sessionIdKey = 'sessionID' as const
const executionOutcomes = new Map<ExecutionEvent['type'], TerminalOutcome>([
  ['session.execution.succeeded', 'succeeded'],
  ['session.execution.failed', 'failed'],
  ['session.execution.interrupted', 'interrupted']
])

function eventExecution(event: OpenCodeEvent): Execution | undefined {
  const outcome = executionOutcomes.get(event.type as ExecutionEvent['type'])
  if (outcome === undefined) {
    return undefined
  }

  const execution = event as ExecutionEvent
  if (execution.type === 'session.execution.interrupted' && execution.data.reason === 'shutdown') {
    return undefined
  }

  return {
    sessionId: execution.data.sessionID,
    outcome,
    idleId: execution.id.replace(/^evt_/v, 'msg_')
  }
}

async function writeOperations(
  mem0: Mem0Tools,
  session: Parameters<Mem0Tools['add']>[0],
  operations: ReturnType<typeof parseOperations>
): Promise<void> {
  let pending: Promise<void> = Promise.resolve()
  for (const operation of operations) {
    pending = pending.then(async () =>
      operation.action === 'add'
        ? mem0.add(session, operation.text)
        : mem0.update(session, operation.memoryId, operation.text)
    )
  }

  await pending
}

async function processExecution(options: RunnerOptions, execution: Execution): Promise<void> {
  const { ctx, mem0, signal } = options
  const session = await ctx.session.get({ [sessionIdKey]: execution.sessionId }, { signal })
  const messages = await ctx.session.context({ [sessionIdKey]: execution.sessionId }, { signal })
  const items = buildEvidence(messages, execution.idleId)
  const searchQuery = buildSearchQuery(items)
  if (searchQuery === '') {
    return
  }

  const memories = await mem0.search(session, searchQuery, options.limit)
  const prompt = buildExtractionPrompt(items, memories, execution.outcome)
  const model = options.extractionModel ?? session.model
  const generated = await ctx.generate.text(
    {
      prompt,
      ...(model !== undefined && { model })
    },
    { signal }
  )
  const memoryIds = new Set(memories.map((memory) => memory.id))
  await writeOperations(mem0, session, parseOperations(generated.text, memoryIds))
}

function enqueueExecution(
  queue: Map<string, Promise<void>>,
  options: RunnerOptions,
  execution: Execution
): void {
  const previous = queue.get(execution.sessionId) ?? Promise.resolve()
  const next = previous
    .then(async () => {
      await processExecution(options, execution)
    })
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
      signal: options.signal
    })) {
      const execution = eventExecution(event)
      if (execution !== undefined) {
        enqueueExecution(queue, options, execution)
      }
    }
  } catch {
    // Cleanup aborts the event stream. Extraction is intentionally best effort.
  }

  await Promise.all(queue.values())
}
