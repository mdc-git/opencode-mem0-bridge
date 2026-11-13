import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

const repository = path.resolve(import.meta.dirname, '../..')

const projectScopeTestScript = `
    import assert from 'node:assert/strict'
    import path from 'node:path'
    import process from 'node:process'
    import plugin from './plugins/mem0-bridge/index.ts'
    import { resolveProject, resolveProjects } from './plugins/mem0-bridge/project-scope.ts'

    const fixture = process.env.PROJECT_SCOPE_FIXTURE
    assert.ok(fixture)
    const main = path.join(fixture, 'main')
    const linked = path.join(fixture, 'linked')
    const plain = path.join(fixture, 'plain')
    const deepFile = path.join(main, 'nested', 'deep', 'file.txt')
    const worktreeFile = path.join(linked, 'worktree-file.txt')
    const plainFile = path.join(plain, 'file.txt')
    const sessionDirectory = path.join(main, 'sub')

    assert.equal(await resolveProject(deepFile, main), main)
    assert.equal(await resolveProject(worktreeFile, main), main)
    assert.equal(await resolveProject('nested/deep/file.txt', main), main)
    assert.equal(await resolveProject(plain, main), plain)
    assert.equal(await resolveProject(plainFile, main), plain)
    assert.equal(await resolveProject(path.join(plain, 'missing'), main), path.join(plain, 'missing'))
    assert.equal(await resolveProject(path.join(main, 'missing-file'), main), main)
    assert.deepEqual(await resolveProjects([deepFile, main, linked, plain, deepFile], main), [main, plain])

    const registration = { dispose: async () => {} }
    const hooks = {}
    const toolHooks = {}
    let sessionGets = 0
    const session = { id: 'session', agent: 'agent', location: { directory: sessionDirectory } }
    const messages = [
      {
        type: 'assistant',
        content: [
          { type: 'tool', name: 'read', state: { input: { path: deepFile } } },
          { type: 'tool', name: 'edit', state: { input: { file_path: worktreeFile } } },
          { type: 'tool', name: 'write', state: { input: { path: plainFile } } }
        ]
      }
    ]
    const searches = []
    const ctx = {
      options: { command: ['mem0'] },
      mcp: {
        list: async () => ({ data: [] }),
        transform: async (fn) => { fn({ list: () => [], set: () => {} }); return registration }
      },
      skill: { transform: async (fn) => { fn({ add: () => {} }); return registration } },
      permission: { hook: async () => registration },
      session: {
        get: async () => { sessionGets += 1; return session },
        context: async () => messages,
        hook: async (name, fn) => { hooks[name] = fn; return registration }
      },
      tool: {
        hook: async (name, fn) => { toolHooks[name] = fn; return registration },
        list: async () => [{
          id: 'mem0_search_memories',
          execute: async (input) => {
            searches.push(input)
            return { output: { results: [{ id: 'm1', memory: 'remember', project: main }] } }
          }
        }]
      }
    }
    const dispose = await plugin.setup(ctx)
    const executeBefore = toolHooks['execute.before']
    assert.equal(typeof executeBefore, 'function')

    const addInput = { project: worktreeFile, text: 'fact' }
    const addEvent = { tool: 'mem0_add_memory', sessionID: 'session', agent: 'agent', messageID: 'message', id: 'call-add', input: addInput }
    await executeBefore(addEvent)
    assert.notEqual(addEvent.input, addInput)
    assert.deepEqual(addEvent.input, { project: main, text: 'fact' })
    assert.deepEqual(addInput, { project: worktreeFile, text: 'fact' })

    const searchEvent = { tool: 'mem0_search_memories', sessionID: 'session', agent: 'agent', messageID: 'message', id: 'call-search', input: { query: 'q' } }
    await executeBefore(searchEvent)
    assert.deepEqual(searchEvent.input, { query: 'q', projects: [main] })

    const getEvent = { tool: 'mem0_get_memories', sessionID: 'session', agent: 'agent', messageID: 'message', id: 'call-get', input: { projects: ['../nested/deep/file.txt', plain] } }
    await executeBefore(getEvent)
    assert.deepEqual(getEvent.input, { projects: [main, plain] })

    const emptyInput = { projects: [] }
    const emptyEvent = { tool: 'mem0_search_memories', sessionID: 'session', agent: 'agent', messageID: 'message', id: 'call-empty', input: emptyInput }
    await executeBefore(emptyEvent)
    assert.equal(emptyEvent.input, emptyInput)

    const getsBeforeUnrelated = sessionGets
    const unrelatedInput = { project: deepFile }
    const unrelatedEvent = { tool: 'read', sessionID: 'session', agent: 'agent', messageID: 'message', id: 'call-read', input: unrelatedInput }
    await executeBefore(unrelatedEvent)
    assert.equal(unrelatedEvent.input, unrelatedInput)
    assert.equal(sessionGets, getsBeforeUnrelated)

    const promptEvent = { sessionID: 'session', prompt: { text: 'question' }, metadata: {} }
    await hooks.prompt(promptEvent)
    assert.deepEqual(searches[0].projects, [main, plain])
    const snapshot = promptEvent.metadata['mdc-git.mem0/project-memory']
    assert.ok(snapshot.includes('Projects searched: ' + main + ', ' + plain))

    await dispose()
`

test('resolves memory projects on the client before calling Mem0', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'mem0-bridge-projects-'))
  const root = await realpath(temporary)
  const main = path.join(root, 'main')
  const linked = path.join(root, 'linked')
  const plain = path.join(root, 'plain')
  try {
    await mkdir(path.join(main, 'nested', 'deep'), { recursive: true })
    await writeFile(path.join(main, 'nested', 'deep', 'file.txt'), 'deep')
    await mkdir(plain, { recursive: true })
    await writeFile(path.join(plain, 'file.txt'), 'plain')
    execFileSync('git', ['init', '-q', main])
    execFileSync('git', [
      '-C',
      main,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-q',
      '-m',
      'initial'
    ])
    execFileSync('git', ['-C', main, 'worktree', 'add', '-q', '--detach', linked])
    await writeFile(path.join(linked, 'worktree-file.txt'), 'worktree')
    await mkdir(path.join(main, 'sub'), { recursive: true })

    const output = execFileSync('bun', ['--eval', projectScopeTestScript], {
      cwd: repository,
      env: { ...process.env, PROJECT_SCOPE_FIXTURE: root }
    })
    assert.equal(output.toString(), '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
