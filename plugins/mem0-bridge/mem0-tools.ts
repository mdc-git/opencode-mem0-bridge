import { CallID } from '@opencode/plugin/promise/tool'
import type { Plugin } from '@opencode/plugin'
import { Agent } from '@opencode/schema/agent'
import { SessionMessage } from '@opencode/schema'
import { Session as SessionSchema } from '@opencode/schema/session'

type Session = {
  id: string
  agent?: string
}

type ToolCall = {
  sessionID: string
  toolID: string
}

export type MemorySearchResult = {
  id: string
  memory: string
  score?: number
}

type ToolResult = {
  output?: unknown
  content?: readonly { type?: string; text?: string }[]
}

function toolID(server: string, name: string): string {
  return `${server}_${name}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function resultValue(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result

  const value = result as ToolResult
  if (value.output !== undefined) return value.output

  const text = value.content?.find((part) => part.type === 'text')?.text
  if (!text) return undefined

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function searchResults(value: unknown): MemorySearchResult[] {
  if (!value || typeof value !== 'object') throw new Error('Mem0 search returned an invalid result')

  const results = (value as { results?: unknown }).results
  if (!Array.isArray(results)) throw new Error('Mem0 search returned no results list')

  return results.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const result = item as { id?: unknown; memory?: unknown; score?: unknown }
    if (typeof result.id !== 'string' || typeof result.memory !== 'string') return []
    return [{
      id: result.id,
      memory: result.memory,
      ...(typeof result.score === 'number' ? { score: result.score } : {})
    }]
  })
}

export class Mem0Tools {
  constructor(
    private readonly ctx: Plugin.Context,
    private readonly permittedCalls: Map<string, ToolCall>,
    private readonly signal: AbortSignal
  ) {}

  async search(session: Session, query: string, limit = 10): Promise<MemorySearchResult[]> {
    const result = await this.execute(session, 'search_memories', { query, limit })
    return searchResults(resultValue(result))
  }

  async add(session: Session, text: string): Promise<void> {
    await this.execute(session, 'add_memory', { text })
  }

  async update(session: Session, memoryID: string, text: string): Promise<void> {
    await this.execute(session, 'update_memory', { memory_id: memoryID, text })
  }

  private async execute(session: Session, name: string, input: Record<string, unknown>): Promise<unknown> {
    const agent = session.agent ?? (await this.ctx.agent.list(undefined, { signal: this.signal })).data[0]?.id
    if (!agent) throw new Error(`Session ${session.id} has no selected agent`)

    const id = CallID.make(crypto.randomUUID())
    const idText = String(id)
    const effectiveToolID = toolID('mem0', name)
    const tool = (await this.ctx.tool.list()).find((candidate) => candidate.id === effectiveToolID)
    if (!tool) throw new Error(`MCP tool ${effectiveToolID} is unavailable`)

    this.permittedCalls.set(idText, { sessionID: session.id, toolID: effectiveToolID })
    try {
      return await tool.execute(input, {
        sessionID: SessionSchema.ID.make(session.id),
        agent: Agent.ID.make(agent),
        messageID: SessionMessage.ID.create(),
        id,
        signal: this.signal,
        async progress() {}
      })
    } finally {
      this.permittedCalls.delete(idText)
    }
  }
}
