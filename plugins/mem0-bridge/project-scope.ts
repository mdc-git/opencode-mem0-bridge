import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, normalize, resolve } from 'node:path'

async function nearestExisting(path: string): Promise<string> {
  try {
    await stat(path)
    return path
  } catch {
    const parent = dirname(path)
    return parent === path ? path : nearestExisting(parent)
  }
}

async function gitOutput(directory: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      [
        '-C',
        directory,
        'rev-parse',
        '--path-format=absolute',
        '--show-toplevel',
        '--git-common-dir'
      ],
      (error, stdout) => {
        if (error === null) {
          resolvePromise(stdout)
        } else {
          reject(new Error(error.message, { cause: error }))
        }
      }
    )
  })
}

async function gitRoot(directory: string): Promise<string | undefined> {
  try {
    const output = await gitOutput(directory)
    const [toplevel, commonDir] = output.trimEnd().split('\n', 2)
    return basename(commonDir) === '.git' ? dirname(commonDir) : toplevel
  } catch {
    return undefined
  }
}

export async function resolveProject(path: string, base: string): Promise<string> {
  const absolute = resolve(base, path)
  const existing = await nearestExisting(absolute)
  const real = await realpath(existing)
  const info = await stat(real)
  const folder = info.isDirectory() ? real : dirname(real)
  const root = await gitRoot(folder)
  if (root !== undefined) {
    return root
  }

  return existing === absolute ? folder : normalize(absolute)
}

export async function resolveProjects(paths: readonly string[], base: string): Promise<string[]> {
  const resolved = await Promise.all(paths.map(async (path) => resolveProject(path, base)))
  return [...new Set(resolved)]
}
