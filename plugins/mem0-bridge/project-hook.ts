import type { Plugin } from '@opencode/plugin'
import type { Registration } from '@opencode/plugin/promise/registration'
import { resolveProject, resolveProjects } from './project-scope.ts'

const PROJECT_TOOLS = new Set(['mem0_add_memory', 'mem0_delete_all_memories', 'mem0_move_memory'])
const PROJECTS_TOOLS = new Set(['mem0_search_memories', 'mem0_get_memories'])
const sessionIdKey = 'sessionID' as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')
}

async function projectInput(
  input: Record<string, unknown>,
  sessionDirectory: string
): Promise<Record<string, unknown> | undefined> {
  if (typeof input.project !== 'string') {
    return undefined
  }

  return {
    ...input,
    project: await resolveProject(input.project, sessionDirectory)
  }
}

async function projectsInput(
  input: Record<string, unknown>,
  sessionDirectory: string
): Promise<Record<string, unknown> | undefined> {
  if (isStringArray(input.projects)) {
    return {
      ...input,
      projects: await resolveProjects(input.projects, sessionDirectory)
    }
  }

  if (input.projects !== undefined) {
    return undefined
  }

  return {
    ...input,
    projects: [await resolveProject(sessionDirectory, sessionDirectory)]
  }
}

async function resolvedInput(
  tool: string,
  input: unknown,
  sessionDirectory: string
): Promise<Record<string, unknown> | undefined> {
  if (!isRecord(input)) {
    return undefined
  }

  if (PROJECT_TOOLS.has(tool)) {
    return projectInput(input, sessionDirectory)
  }

  return PROJECTS_TOOLS.has(tool) ? projectsInput(input, sessionDirectory) : undefined
}

export async function registerProjectHook(ctx: Plugin.Context): Promise<Registration> {
  return ctx.tool.hook('execute.before', async (event) => {
    if (!PROJECT_TOOLS.has(event.tool) && !PROJECTS_TOOLS.has(event.tool)) {
      return
    }

    const session = await ctx.session.get({ [sessionIdKey]: event.sessionID })
    const input = await resolvedInput(event.tool, event.input, session.location.directory)
    if (input === undefined) {
      return
    }

    event.input = input
  })
}
