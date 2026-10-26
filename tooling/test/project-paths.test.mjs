import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'

const repository = path.resolve(import.meta.dirname, '../..')

const pathCapTestScript = `
    import assert from 'node:assert/strict'
    import plugin from './plugins/mem0-bridge/index.ts'
    import { automaticMemory } from './plugins/mem0-bridge/automatic-memory-runner.ts'
    import { Event, SessionMessage } from '@opencode/schema'

    const tool = (path) => ({ type: 'tool', name: 'read', state: { status: 'completed', input: { path } } })
    const files = (from, to) => Array.from({ length: to - from }, (_, index) => '/repo-' + (from + index) + '/file')
    const session = { id: 'session', agent: 'agent', location: { directory: '/workspace' } }
    const registration = { dispose: async () => {} }

    const retrievalMessages = [
      { type: 'assistant', content: files(0, 12).map(tool) }
    ]
    const searches = []
    const hooks = {}
    const retrievalCtx = {
      options: { command: ['mem0'] },
      mcp: {
        list: async () => ({ data: [] }),
        transform: async (fn) => { fn({ list: () => [], set: () => {} }); return registration }
      },
      skill: { transform: async (fn) => { fn({ add: () => {} }); return registration } },
      permission: { hook: async () => registration },
      session: {
        get: async () => session,
        context: async () => retrievalMessages,
        hook: async (name, fn) => { hooks[name] = fn; return registration }
      },
      tool: { list: async () => ['search_memories', 'add_memory', 'update_memory'].map((name) => ({
        id: 'mem0_' + name,
        execute: async (input) => {
          searches.push(input)
          return { output: { results: [] } }
        }
      })) }
    }
    const dispose = await plugin.setup(retrievalCtx)
    await hooks.prompt({ sessionID: 'session', prompt: { text: 'question' }, metadata: {} })
    await dispose()
    assert.deepEqual(searches[0].projects, ['/workspace', ...files(0, 12).toReversed().slice(0, 10)])

    const eventId = Event.ID.make('evt_turn')
    const executionMessages = [
      { type: 'assistant', content: [tool('/previous-turn/file')] },
      { type: 'idle', id: 'msg_previous', outcome: 'succeeded' },
      { type: 'user', text: 'remember these repositories' },
      { type: 'assistant', content: [{ type: 'text', text: 'done' }, ...files(0, 6).map(tool)] },
      { type: 'assistant', content: files(6, 12).map(tool) },
      { type: 'idle', id: SessionMessage.ID.fromEvent(eventId), outcome: 'succeeded' }
    ]
    const turnPaths = files(0, 12).toReversed().slice(0, 10)
    const extraction = { searches: [], prompts: [], writes: [] }
    const runnerCtx = {
      location: { directory: '/workspace' },
      event: {
        subscribe: async function* () {
          yield { type: 'session.execution.succeeded', id: eventId, data: { sessionID: 'session' } }
        }
      },
      session: { get: async () => session, context: async () => executionMessages },
      generate: { text: async ({ prompt }) => { extraction.prompts.push(prompt); return { text: '[]' } } }
    }
    const mem0 = {
      search: async (_session, _query, _limit, projects) => { extraction.searches.push(projects); return [] },
      write: async (_session, operations, paths) => { extraction.writes.push({ operations, paths }) }
    }
    await automaticMemory({ ctx: runnerCtx, mem0, signal: new AbortController().signal })
    assert.deepEqual(extraction.searches, [['/workspace', ...turnPaths.slice(0, 9)]])
    assert.deepEqual(extraction.writes, [{ operations: [], paths: turnPaths }])
    assert.ok(!extraction.prompts[0].includes('/previous-turn/file'))
`

test('retrieval and extraction cap and order their project candidates', () => {
  const output = execFileSync('bun', ['--eval', pathCapTestScript], { cwd: repository })
  assert.equal(output.toString(), '')
})
