import { execFile } from 'node:child_process'
import process from 'node:process'
import { Model, Provider, type Plugin } from '@opencode/plugin'
import type { Registration } from '@opencode/plugin/promise/registration'

export const MCP_NAME = 'mem0'

type LocalConnection = { type: 'local'; command: string[]; environment?: Record<string, string> }

type BridgeConnection = LocalConnection | { type: 'remote'; url: string; oauth: false }

export type BridgeOptions = {
  connection: BridgeConnection
  startup?: LocalConnection
  automaticExtraction: boolean
  extractionModel?: Model.Ref
}

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(([key, entry]) => key.length > 0 && typeof entry === 'string')
  )
}

function validateCommand(value: unknown): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((part) => typeof part !== 'string' || part.length === 0)
  ) {
    throw new TypeError('mem0-bridge command must be a nonempty array of nonempty strings')
  }
}

function validateEnvironment(value: unknown): asserts value is Record<string, string> | undefined {
  if (value !== undefined && !isStringMap(value)) {
    throw new TypeError('mem0-bridge environment must be a string-to-string object')
  }
}

function parseModelSelector(value: unknown): Model.Ref | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }

  const match = /^(?<provider>[^#\/]+)\/(?<model>[^#]+)(?:#(?<variant>.+))?$/sv.exec(value.trim())
  if (match === null) {
    throw new Error(`Invalid extractionModel selector: ${value}`)
  }

  const { provider, model, variant } = match.groups!
  return modelReference(provider, model, variant)
}

function modelReference(provider: string, model: string, variant: string | undefined): Model.Ref {
  const providerKey = 'providerID' as const
  const reference = {
    [providerKey]: Provider.ID.make(provider),
    id: Model.ID.make(model)
  }

  return variant === undefined
    ? reference
    : {
        ...reference,
        variant: Model.VariantID.make(variant)
      }
}

function remoteConnection(value: Readonly<Record<string, unknown>>): BridgeConnection {
  if (typeof value.url !== 'string') {
    throw new TypeError('mem0-bridge url must be an absolute HTTP or HTTPS URL')
  }

  const url = new URL(value.url)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('mem0-bridge url must use HTTP or HTTPS')
  }

  return { type: 'remote', url: url.href, oauth: false }
}

function localConnection(value: Readonly<Record<string, unknown>>): LocalConnection {
  validateCommand(value.command)
  validateEnvironment(value.environment)

  return {
    type: 'local',
    command: [...value.command],
    ...(value.environment !== undefined && { environment: { ...value.environment } })
  }
}

function connectionOptions(
  value: Readonly<Record<string, unknown>>
): Pick<BridgeOptions, 'connection' | 'startup'> {
  if (value.url === undefined) {
    return { connection: localConnection(value) }
  }

  const connection = remoteConnection(value)
  return value.command === undefined
    ? { connection }
    : { connection, startup: localConnection(value) }
}

export function bridgeOptions(value: Readonly<Record<string, unknown>>): BridgeOptions {
  const extractionModel = parseModelSelector(value.extractionModel)

  return {
    ...connectionOptions(value),
    automaticExtraction: value.automaticExtraction === true,
    ...(extractionModel !== undefined && { extractionModel })
  }
}

export async function isMcpConfigured(ctx: Plugin.Context): Promise<boolean> {
  let isConfigured = false
  const registration = await ctx.mcp.transform((editor) => {
    isConfigured = editor.list().some(([name]) => name === MCP_NAME)
  })
  await registration.dispose()
  return isConfigured
}

export async function registerMcp(
  ctx: Plugin.Context,
  options: BridgeOptions
): Promise<Registration> {
  if (options.startup !== undefined) {
    const [command, ...args] = options.startup.command
    const execution = {
      cwd: ctx.location.directory,
      env: { ...process.env, ...options.startup.environment },
      timeout: 120_000
    }
    await new Promise<void>((resolve, reject) => {
      execFile(command, args, execution, (error) => {
        if (error) {
          reject(new Error(`Mem0 HTTP startup failed: ${error.message}`, { cause: error }))
        } else {
          resolve()
        }
      })
    })
  }

  return ctx.mcp.transform((editor) => {
    editor.set(MCP_NAME, {
      ...options.connection,
      protocol: '2026-07-28',
      timeout: { startup: 120_000 }
    })
  })
}
