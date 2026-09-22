import { setTimeout as delay } from 'node:timers/promises'
import { CallID } from '@opencode/plugin/promise/tool'
import type { Plugin } from '@opencode/plugin'
import { Agent } from '@opencode/schema/agent'
import { SessionMessage } from '@opencode/schema'
import { Session as SessionSchema } from '@opencode/schema/session'

const sessionIdKey = 'sessionID' as const
const messageIdKey = 'messageID' as const
const memoryIdKey = 'memory_id' as const
const TOOL_WAIT_MS = 5000
const TOOL_RETRY_MS = 100

type Session = {
  id: string
  agent?: string
}

type ToolCall = {
  sessionId: string
  toolId: string
}

type RegisteredTool = Awaited<ReturnType<Plugin.Context['tool']['list']>>[number]

export type MemorySearchResult = {
  id: string
  memory: string
  score?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function hasSearchFields(value: unknown): value is { id: string; memory: string; score?: unknown } {
  return isRecord(value) && typeof value.id === 'string' && typeof value.memory === 'string'
}

function parseSearchResult(value: unknown): MemorySearchResult | undefined {
  if (!hasSearchFields(value)) {
    return undefined
  }

  return {
    id: value.id,
    memory: value.memory,
    ...(typeof value.score === 'number' && { score: value.score })
  }
}

function searchResults(value: unknown): MemorySearchResult[] {
  if (!isRecord(value)) {
    throw new Error('Mem0 search returned an invalid result')
  }

  const { results } = value
  if (!Array.isArray(results)) {
    throw new TypeError('Mem0 search returned no results list')
  }

  return results.flatMap((item) => {
    const result = parseSearchResult(item)
    return result === undefined ? [] : [result]
  })
}

export class Mem0Tools {
  constructor(
    private readonly ctx: Plugin.Context,
    private readonly permittedCalls: Map<string, ToolCall>,
    private readonly signal: AbortSignal
  ) {}

  private async execute(
    session: Session,
    name: string,
    input: Record<string, unknown>
  ): Promise<unknown> {
    const agent = await this.agent(session)

    const id = CallID.make(crypto.randomUUID())
    const effectiveToolId = `mem0_${name}`
    const tool = await this.tool(effectiveToolId)

    this.permittedCalls.set(id, {
      sessionId: session.id,
      toolId: effectiveToolId
    })
    try {
      const result = await tool.execute(input, {
        [sessionIdKey]: SessionSchema.ID.make(session.id),
        agent: Agent.ID.make(agent),
        [messageIdKey]: SessionMessage.ID.create(),
        id,
        signal: this.signal,
        async progress() {
          await Promise.resolve()
        }
      })
      return result.output
    } finally {
      this.permittedCalls.delete(id)
    }
  }

  private async agent(session: Session): Promise<string> {
    if (session.agent !== undefined) {
      return session.agent
    }

    const agents = await this.ctx.agent.list(undefined, {
      signal: this.signal
    })
    const agent = agents.data[0]?.id
    if (agent === undefined) {
      throw new Error(`Session ${session.id} has no selected agent`)
    }

    return agent
  }

  private async tool(id: string, deadline = Date.now() + TOOL_WAIT_MS): Promise<RegisteredTool> {
    const tools = await this.ctx.tool.list()
    const tool = tools.find((candidate) => candidate.id === id)
    if (tool !== undefined) {
      return tool
    }

    if (Date.now() >= deadline) {
      throw new Error(`MCP tool ${id} is unavailable`)
    }

    await delay(TOOL_RETRY_MS)
    return this.tool(id, deadline)
  }

  async search(session: Session, query: string, limit = 10): Promise<MemorySearchResult[]> {
    const result = await this.execute(session, 'search_memories', {
      query,
      limit
    })
    return searchResults(result)
  }

  async add(session: Session, text: string): Promise<void> {
    await this.execute(session, 'add_memory', { text })
  }

  async update(session: Session, memoryId: string, text: string): Promise<void> {
    await this.execute(session, 'update_memory', {
      [memoryIdKey]: memoryId,
      text
    })
  }
}
