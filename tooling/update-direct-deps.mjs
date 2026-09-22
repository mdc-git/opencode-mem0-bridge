import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const packagePath = 'package.json'
const sections = ['dependencies', 'devDependencies']
const anchors = new Map([
  ['@opencode/plugin', 'latest'],
  ['@opencode/schema', 'latest'],
  ['eslint-config-xo', '^2.0.0'],
  ['typescript', '^6.0.3']
])
const apply = process.argv.includes('--apply')
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))

function writeCommandOutput(output) {
  if (typeof output === 'string') {
    process.stderr.write(output)
  }
}

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8' })
  } catch (error) {
    writeCommandOutput(error.stdout)
    writeCommandOutput(error.stderr)
    throw error
  }
}

function resolveGraph(manifest, name) {
  const cwd = mkdtempSync(path.join(tmpdir(), name))

  try {
    writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    run('bun', ['install', '--lockfile-only', '--ignore-scripts', '--no-cache'], cwd)
    const source = [
      "const text = await Bun.file('bun.lock').text()",
      'process.stdout.write(JSON.stringify(Bun.JSONC.parse(text)))'
    ].join(';')
    return JSON.parse(run('bun', ['-e', source], cwd))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

function bunResolvedVersion(lock, name) {
  const resolution = lock.packages[name]?.[0]
  if (typeof resolution !== 'string') {
    throw new TypeError(`No root Bun resolution found for ${name}`)
  }

  const prefix = `${name}@`
  if (!resolution.startsWith(prefix)) {
    throw new Error(`Unexpected root Bun resolution for ${name}: ${resolution}`)
  }

  return resolution.slice(prefix.length)
}

function nextSpecifier(current, version) {
  if (current.startsWith('^')) {
    return `^${version}`
  }

  if (current.startsWith('~')) {
    return `~${version}`
  }

  return version
}

function sectionChanges(manifest, section, upgrade) {
  const changes = Object.entries(manifest[section] ?? {})
    .map(([name, current]) => {
      const next = anchors.get(name) ?? nextSpecifier(current, bunResolvedVersion(upgrade, name))
      return next === current ? undefined : { section, name, current, next }
    })
    .filter((change) => change !== undefined)

  for (const change of changes) {
    manifest[section][change.name] = change.next
  }

  return changes
}

for (const name of anchors.keys()) {
  if (sections.every((section) => typeof pkg[section]?.[name] !== 'string')) {
    throw new Error(`Compatibility anchor is not a direct dependency: ${name}`)
  }
}

process.stdout.write('Resolving current dependency graph...\n')
const baseline = resolveGraph(pkg, 'direct-deps-current-')
const candidate = structuredClone(pkg)
for (const section of sections) {
  for (const name of Object.keys(candidate[section] ?? {})) {
    candidate[section][name] = anchors.get(name) ?? `>=${bunResolvedVersion(baseline, name)}`
  }
}

process.stdout.write('Resolving peer-compatible upgrade graph...\n')
const upgrade = resolveGraph(candidate, 'direct-deps-compatible-')
const changes = sections.flatMap((section) => sectionChanges(pkg, section, upgrade))

for (const { section, name, current, next } of changes) {
  process.stdout.write(`${section}: ${name}: ${current} -> ${next}\n`)
}

if (changes.length === 0) {
  process.stdout.write('All direct dependencies already match the compatible upgrade graph.\n')
} else if (apply) {
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
  process.stdout.write('\npackage.json updated.\n')
} else {
  process.stdout.write('\nDry run only. Re-run with --apply to update package.json.\n')
}
