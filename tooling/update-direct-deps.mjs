import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const packagePath = 'package.json'
const sections = ['dependencies', 'devDependencies']
const anchors = new Map([
  ['@opencode/plugin', { candidate: 'latest', write: 'candidate' }],
  ['@opencode/schema', { candidate: 'latest', write: 'candidate' }],
  ['eslint-config-xo', { candidate: '^2.0.0', write: 'candidate' }],
  ['typescript', { candidate: '^6.0.3', write: 'candidate' }]
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

function directSpecifier(manifest, name) {
  for (const section of sections) {
    const specifier = manifest[section]?.[name]
    if (typeof specifier === 'string') {
      return specifier
    }
  }

  return undefined
}

function validateAnchorCandidate(name, policy) {
  if (typeof policy.candidate !== 'string' || policy.candidate.length === 0) {
    throw new TypeError(`Compatibility anchor has no candidate constraint: ${name}`)
  }
}

function validateAnchorWritePolicy(name, policy) {
  if (policy.write !== 'candidate' && policy.write !== 'resolved') {
    throw new TypeError(`Compatibility anchor has invalid write policy: ${name}`)
  }
}

function validateAnchor(name, policy, manifest) {
  if (directSpecifier(manifest, name) === undefined) {
    throw new Error(`Compatibility anchor is not a direct dependency: ${name}`)
  }

  validateAnchorCandidate(name, policy)
  validateAnchorWritePolicy(name, policy)
}

function validateAnchorPolicy(manifest) {
  if (anchors.size === 0) {
    throw new Error('Configure at least one compatibility anchor before using this updater')
  }

  for (const [name, policy] of anchors) {
    validateAnchor(name, policy, manifest)
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

function rootBunResolution(lock, name) {
  const resolution = lock.packages?.[name]?.[0]
  if (typeof resolution !== 'string') {
    throw new TypeError(`No root Bun resolution found for ${name}`)
  }

  return resolution
}

function bunResolvedVersion(lock, name) {
  const resolution = rootBunResolution(lock, name)
  const prefix = `${name}@`
  if (!resolution.startsWith(prefix)) {
    throw new Error(`Unexpected root Bun resolution for ${name}: ${resolution}`)
  }

  return resolution.slice(prefix.length)
}

function candidateSpecifier(name, baseline) {
  return anchors.get(name)?.candidate ?? `>=${bunResolvedVersion(baseline, name)}`
}

function widenSection(manifest, section, baseline) {
  for (const name of Object.keys(manifest[section] ?? {})) {
    manifest[section][name] = candidateSpecifier(name, baseline)
  }
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

function resolvedSpecifier(name, current, upgrade) {
  const anchor = anchors.get(name)
  return anchor?.write === 'candidate'
    ? anchor.candidate
    : nextSpecifier(current, bunResolvedVersion(upgrade, name))
}

function sectionChanges(manifest, section, upgrade) {
  const changes = Object.entries(manifest[section] ?? {})
    .map(([name, current]) => {
      const next = resolvedSpecifier(name, current, upgrade)
      return next === current ? undefined : { section, name, current, next }
    })
    .filter((change) => change !== undefined)

  for (const change of changes) {
    manifest[section][change.name] = change.next
  }

  return changes
}

validateAnchorPolicy(pkg)
process.stdout.write('Resolving current dependency graph...\n')
const baseline = resolveGraph(pkg, 'direct-deps-current-')
const candidate = structuredClone(pkg)
for (const section of sections) {
  widenSection(candidate, section, baseline)
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
