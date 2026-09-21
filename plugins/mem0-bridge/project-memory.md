# Project Memory

Use the local `mem0` MCP tools as durable engineering memory.

## Retrieval

Before substantial implementation, debugging, architecture, planning,
repository investigation, dependency work, or related engineering, search
memory when previous project knowledge could affect the task.

Use `search_memories` with concrete terms such as a repository or component
name, subsystem, dependency, error, architectural concept, decision, or
constraint.

Treat retrieved memories as context, not authority. Verify facts against the
current repository when they affect implementation correctness.

Use `get_memories`, `get_memory`, and `get_memory_history` only when auditing
the stored memory set or inspecting a known memory.

## Storage

Use `add_memory` only for information that is:

- durable across sessions
- verified
- non-obvious
- likely to affect future implementation or debugging
- expensive to rediscover

Good memories include architectural decisions, project constraints,
conventions and invariants, important dependency relationships, environment
requirements, and verified causes of recurring failures.

Before adding a fact that may already exist, search for it first. Use
`update_memory` when the existing fact has changed instead of creating a
contradictory duplicate.

Do not store temporary progress, routine command or test results, generated
output, line numbers, guesses, hypotheses, secrets, credentials, or facts
that are immediately obvious from the current source code.

Use `delete_memory` for targeted removal. Use `delete_all_memories` only when
the user explicitly requests clearing all project memory.
