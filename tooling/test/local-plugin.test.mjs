import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const repository = path.resolve(import.meta.dirname, '../..')
const localPlugin = path.join(repository, '.opencode')
const opencode = fileURLToPath(import.meta.resolve('@opencode/cli/bin/opencode.exe'))
const password = 'mem0-bridge-plugin-test-password'
const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`

async function fetchApi(base, requestPath, options) {
  try {
    return await fetch(new URL(requestPath, base), {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(10_000),
      headers: {
        authorization,
        'content-type': 'application/json',
        ...options.headers
      }
    })
  } catch (error) {
    throw new Error(`${requestPath}: ${String(error)}`, { cause: error })
  }
}

async function api(base, requestPath, options = {}) {
  const response = await fetchApi(base, requestPath, options)
  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`)
  }

  return response.status === 204 ? undefined : response.json()
}

async function serverUrl(server) {
  const lines = createInterface({ input: server.stdout })
  try {
    const [line] = await Promise.race([
      once(lines, 'line'),
      once(server, 'exit').then(([code]) => {
        throw new Error(`server exited ${code}`)
      })
    ])
    return JSON.parse(line).url
  } finally {
    lines.close()
  }
}

function isolatedEnvironment(root) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('OPENCODE_') && !['HOME', 'TMPDIR', 'TMP', 'TEMP'].includes(name)
    )
  )
  return {
    ...inherited,
    HOME: path.join(root, 'home'),
    OPENCODE_CONFIG_CONTENT: '{}',
    OPENCODE_CONFIG_DIR: path.join(root, 'config'),
    OPENCODE_DB: path.join(root, 'opencode.db'),
    OPENCODE_DISABLE_MODELS_FETCH: 'true',
    OPENCODE_PASSWORD: password,
    TMPDIR: path.join(root, 'tmp'),
    TMP: path.join(root, 'tmp'),
    TEMP: path.join(root, 'tmp'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
    XDG_DATA_HOME: path.join(root, 'data'),
    XDG_STATE_HOME: path.join(root, 'state')
  }
}

function startServer(project, root) {
  const child = spawn(process.env.OPENCODE_BIN ?? opencode, ['serve', '--stdio', '--port', '0'], {
    cwd: project,
    env: isolatedEnvironment(root),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let diagnostics = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    diagnostics += chunk
  })
  return { child, diagnostics: () => diagnostics }
}

async function stopServer(server) {
  if (server.exitCode !== null) {
    return
  }

  server.kill('SIGTERM')
  const closed = await Promise.race([
    once(server, 'close').then(() => true),
    delay(2000).then(() => false)
  ])
  if (!closed) {
    server.kill('SIGKILL')
  }
}

async function plugin(base, project) {
  const plugins = await api(
    base,
    `/api/plugin?location%5Bdirectory%5D=${encodeURIComponent(project)}`
  )
  return plugins.data.find((item) => item.id === 'local.mem0-bridge')
}

function waitForPlugin(base, project, diagnostics) {
  return new Promise((resolve, reject) => {
    let lastPlugin
    const finish = (result) => {
      clearTimeout(timer)
      clearInterval(interval)
      result()
    }

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `local mem0 bridge plugin did not activate\nstate=${JSON.stringify(lastPlugin, null, 2)}\nstderr=${diagnostics()}`
          )
        )
      )
    }, 15_000)
    const check = () => {
      plugin(base, project)
        .then((current) => {
          lastPlugin = current
          if (current?.state?.status === 'active') {
            finish(() => resolve(current))
          }
        })
        .catch((error) => finish(() => reject(error)))
    }

    const interval = setInterval(check, 100)
    check()
  })
}

async function exercisePlugin(root, project) {
  await mkdir(project, { recursive: true })
  await mkdir(path.join(root, 'tmp'), { recursive: true })
  await writeFile(
    path.join(project, 'opencode.jsonc'),
    `${JSON.stringify({
      plugins: [
        {
          package: localPlugin,
          options: { command: [process.execPath, '-e', 'process.exit(0)'] }
        }
      ]
    })}\n`
  )
  const running = startServer(project, root)
  try {
    const base = await serverUrl(running.child)
    const current = await waitForPlugin(base, project, running.diagnostics)
    assert.equal(current.source.type, 'local')
    assert.equal(current.source.path, path.join(localPlugin, 'index.ts'))
    return current.id
  } finally {
    await stopServer(running.child)
  }
}

test('checkout-local server plugin activates from .opencode', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opencode-mem0-bridge-'))
  const project = path.join(root, 'project')
  try {
    assert.equal(await exercisePlugin(root, project), 'local.mem0-bridge')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

const scopeTestScript = String.raw`
    import assert from 'node:assert/strict'
    import plugin from './plugins/mem0-bridge/index.ts'
    import { touchedPaths, buildExtractionPrompt } from './plugins/mem0-bridge/automatic-memory.ts'
    import { parseOperations } from './plugins/mem0-bridge/memory-operations.ts'
    import { Mem0Tools } from './plugins/mem0-bridge/mem0-tools.ts'

    const tool = (input) => ({ type: 'tool', state: { input } })
    const messages = [
      { type: 'assistant', content: [tool({ path: 'old/file' }), tool({ file_path: '/other/edit' })] },
      { type: 'assistant', content: [tool({ filePath: 'old/file' }), tool({ notebook_path: 'book' }), tool({ command: 'cat /ignored' })] }
    ]
    const paths = ['/workspace/book', '/workspace/old/file', '/other/edit']
    assert.deepEqual(touchedPaths(messages, '/workspace'), paths)
    const candidates = ['/workspace', ...paths]
    const ids = new Set(['known'])
    const add = { action: 'add', project: paths[0], text: 'fact' }
    const update = { action: 'update', memoryID: 'known', text: 'updated' }
    const operations = parseOperations(JSON.stringify([add, update]), ids, new Set(candidates))
    assert.deepEqual(operations, [add, { action: 'update', memoryId: 'known', text: 'updated' }])
    assert.throws(() => parseOperations(JSON.stringify([{ ...add, project: '/unknown' }]), ids, new Set(candidates)))
    assert.throws(() => parseOperations(JSON.stringify([{ action: 'add', text: 'fact' }]), ids, new Set(candidates)))
    const extractionPrompt = buildExtractionPrompt([], [{ id: 'known', memory: 'remember', project: '/resolved' }], 'succeeded', candidates)
    assert.ok(extractionPrompt.includes(paths[0]))
    assert.ok(extractionPrompt.includes('project: /resolved'))
    assert.ok(extractionPrompt.includes('"project":"<candidate>"'))

    const calls = []
    const registration = { dispose: async () => {} }
    const hooks = {}
    const ctx = {
      options: { command: ['mem0'] },
      mcp: {
        list: async () => ({ data: [] }),
        transform: async (fn) => { fn({ list: () => [], set: () => {} }); return registration }
      },
      skill: { transform: async (fn) => { fn({ add: () => {} }); return registration } },
      permission: { hook: async () => registration },
      session: {
        get: async () => ({ id: 'session', agent: 'agent', location: { directory: '/workspace' } }),
        context: async () => messages,
        hook: async (name, fn) => { hooks[name] = fn; return registration }
      },
      tool: { list: async () => ['search_memories', 'add_memory', 'update_memory'].map((name) => ({
        id: 'mem0_' + name,
        execute: async (input) => {
          calls.push({ name, input })
          return { output: { results: [{ id: 'known', memory: 'remember', project: '/resolved' }] } }
        }
      })) }
    }
    const dispose = await plugin.setup(ctx)
    const event = { sessionID: 'session', prompt: { text: ' question ' }, metadata: {} }
    await hooks.prompt(event)
    assert.deepEqual(calls[0], { name: 'search_memories', input: { query: 'question', projects: candidates, limit: 3, threshold: 0.5 } })
    assert.equal(event.metadata['mdc-git.mem0/project-memory'], [
      '<project_memory>',
      'This complete snapshot supersedes earlier project-memory snapshots.',
      'Projects searched: ' + candidates.join(', '),
      '- [/resolved] remember',
      '</project_memory>'
    ].join('\n'))
    const mem0 = new Mem0Tools(ctx, new Map(), new AbortController().signal)
    await mem0.write({ id: 'session', agent: 'agent' }, operations, paths)
    assert.deepEqual(calls.slice(1), [
      { name: 'add_memory', input: { project: paths[0], metadata: { origin: 'auto', paths }, text: 'fact' } },
      { name: 'update_memory', input: { memory_id: 'known', text: 'updated' } }
    ])
    await dispose()
`

test('repository paths scope retrieval, extraction, and writes', () => {
  const output = execFileSync('bun', ['--eval', scopeTestScript], { cwd: repository })
  assert.equal(output.toString(), '')
})
