import type { Plugin } from '@opencode/plugin'
import type { Model } from '@opencode/schema/model'
import type { Mem0Tools } from './mem0-tools.ts'
import {
  buildEvidence,
  buildExtractionPrompt,
  buildSearchQuery,
  parseOperations,
  type TerminalOutcome
} from './automatic-memory.ts'

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

async function processExecution(
  options: RunnerOptions,
  sessionID: string,
  outcome: TerminalOutcome,
  idleID: string
): Promise<void> {
  const { controller, ctx, mem0 } = options
  const session = await ctx.session.get({ sessionID }, { signal: controller.signal }) as Session
  const messages = await ctx.session.context({ sessionID }, { signal: controller.signal })
  const items = buildEvidence(messages, outcome, idleID)
  const searchQuery = buildSearchQuery(items)
  if (!searchQuery) return

  const memories = await mem0.search(session, searchQuery, options.limit)
  const prompt = buildExtractionPrompt(items, memories, outcome)
  const model = options.extractionModel ?? session.model
  const generated = await ctx.generate.text(
    {
      prompt,
      ...(model === undefined ? {} : { model })
    },
    { signal: controller.signal }
  )
  const operations = parseOperations(generated.text, new Set(memories.map((memory) => memory.id)))

  for (const operation of operations) {
    if (operation.action === 'add') {
      await mem0.add(session, operation.text)
    } else {
      await mem0.update(session, operation.memoryID, operation.text)
    }
  }
}

export async function automaticMemory(options: RunnerOptions): Promise<void> {
  const queue = new Map<string, Promise<void>>()

  try {
    for await (const event of options.ctx.event.subscribe({ signal: options.controller.signal })) {
      let outcome: TerminalOutcome
      if (event.type === 'session.execution.succeeded') {
        outcome = 'succeeded'
      } else if (event.type === 'session.execution.failed') {
        outcome = 'failed'
      } else if (event.type === 'session.execution.interrupted') {
        if (event.data.reason === 'shutdown') continue
        outcome = 'interrupted'
      } else {
        continue
      }

      const sessionID = event.data.sessionID
      const idleID = event.id.replace(/^evt_/, 'msg_')
      const previous = queue.get(sessionID) ?? Promise.resolve()
      const next = previous
        .catch(() => undefined)
        .then(() => processExecution(options, sessionID, outcome, idleID))
        .catch(() => undefined)
      queue.set(sessionID, next)
      void next.finally(() => {
        if (queue.get(sessionID) === next) queue.delete(sessionID)
      })
    }
  } catch {
    // Cleanup aborts the event stream. Extraction is intentionally best effort.
  } finally {
    await Promise.all(queue.values())
  }
}
