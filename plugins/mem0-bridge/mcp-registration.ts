import { Model, Provider, type Plugin } from '@opencode/plugin'
import type { Registration } from '@opencode/plugin/promise/registration'

export const MCP_NAME = 'mem0'

export type BridgeOptions = {
  command: string[]
  environment?: Record<string, string>
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
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('mem0-bridge command must be a nonempty array of nonempty strings')
  }

  if (value.some((part) => typeof part !== 'string' || part.length === 0)) {
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

export function bridgeOptions(value: Readonly<Record<string, unknown>>): BridgeOptions {
  validateCommand(value.command)
  validateEnvironment(value.environment)

  const extractionModel = parseModelSelector(value.extractionModel)

  return {
    command: [...value.command],
    ...(value.environment !== undefined && { environment: { ...value.environment } }),
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
  return ctx.mcp.transform((editor) => {
    editor.set(MCP_NAME, {
      type: 'local',
      command: options.command,
      ...(options.environment !== undefined && { environment: options.environment }),
      protocol: '2026-07-28',
      timeout: { startup: 120_000 }
    })
  })
}
