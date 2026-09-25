# OpenCode Mem0 Bridge

An OpenCode V2 server plugin that connects OpenCode to a project-scoped local
[Mem0 MCP server](https://github.com/mdc-git/mem0). It retrieves relevant project
memories for new prompts and can optionally extract durable memories after an
OpenCode execution.

> **Data handling:** Retrieved memories are added as reference context, not instructions.
> When automatic extraction is enabled, execution evidence is sent to the
> configured OpenCode extraction model. Enable it only when that provider and
> data flow are appropriate for your project.

## What it provides

- Retrieves up to three relevant memories once when each user prompt is admitted and stores the exact rendered snapshot in prompt metadata.
- Reprojects persisted memory snapshots as chronological system context immediately after their originating user messages while those messages remain in active history.
- Adds the project-memory policy to every model request; Ollama also receives Mem0 Code Mode guidance.
- Registers the `project-memory` skill with OpenCode.
- Optionally reconciles durable memories after successful, failed, or user-interrupted executions.

## Requirements

- OpenCode V2.
- The local Mem0 MCP server and its [setup requirements](https://github.com/mdc-git/mem0#requirements).
- A configured OpenCode model provider when automatic extraction is enabled.

The Mem0 server owns embeddings, vector search, persistence, and project scoping.
The bridge supplies the OpenCode integration.

## Install and enable

### 1. Install the local Mem0 MCP server

Follow the [Mem0 MCP server installation instructions](https://github.com/mdc-git/mem0#install-from-github). The short form is:

```bash
curl -fsSL https://raw.githubusercontent.com/mdc-git/mem0/master/install.sh | bash
```

The installer uses CPU execution by default. Set `MEM0_PROFILE=gpu` when running
the installer or setup if GPU execution is appropriate. The default embedding
model is `qwen3-embedding:0.6b`.

### 2. Configure OpenCode

Add the plugin and local MCP server to
`$HOME/.config/opencode/opencode.jsonc`. Choose the latest release from the
repository's **Releases** section in the right sidebar on GitHub, then replace
`<release-tag>` in the plugin references below with that release's tag. For
example, `0.0.1` can be a release tag. Replace `<MEM0_ROOT>` with the absolute
path to the Mem0 checkout:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-mem0-bridge@git+https://github.com/mdc-git/opencode-mem0-bridge.git#<release-tag>"
    }
  ],
  "mcp": {
    "servers": {
      "mem0": {
        "type": "local",
        "command": ["<MEM0_ROOT>/run.sh"]
      }
    }
  }
}
```

For GPU execution, add this to the `mem0` server entry:

```jsonc
"environment": {
  "MEM0_PROFILE": "gpu"
}
```

Use `MEM0_EMBEDDING_MODEL` only when overriding the default. Custom embedding
models must produce 1024-dimensional vectors for the current local server setup.

### 3. Verify the connection

From the project you want to use with memory, check the MCP connection:

```bash
opencode mcp list
```

The `mem0` entry should report `connected`. Each OpenCode working directory has
its own Mem0 memory scope.

## Quick start

In OpenCode, ask it to store a fact that should remain useful across sessions:

```text
Store this durable project constraint in project memory: this repository uses Bun for development checks.
```

Start a new turn and ask:

```text
What does project memory say about this repository's development tooling?
```

The bridge searches Mem0 when the prompt is admitted, stores the exact retrieved
snapshot with that prompt, and deterministically reprojects it as chronological
system context while the originating message remains in active history. Normal
OpenCode compaction eventually removes old snapshots from active context.
Repository or technical claims that affect implementation correctness should be
verified against current project evidence; contextual user-provided facts and
preferences can be used unless current evidence contradicts them.

## Automatic extraction

Automatic extraction is disabled by default. Enable it with the plugin object
form and choose a model available through your OpenCode provider:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-mem0-bridge@git+https://github.com/mdc-git/opencode-mem0-bridge.git#<release-tag>",
      "options": {
        "automaticExtraction": true,
        "extractionModel": "provider/model#variant"
      }
    }
  ]
}
```

`extractionModel` uses the `provider/model#variant` format. Omit it to use the
model that triggered the execution. The extractor receives ordered user and
visible agent evidence, tool parameters, and failed tool errors available in the
current execution context. A long execution that has been compacted can omit
earlier evidence that is no longer present in that context. It stores only
verified, durable project knowledge and may return no changes for a turn that
contains nothing worth retaining. Extraction runs asynchronously after the
execution event, and writes occur only for valid `add` or `update` operations.

## Development

Contributors need Node.js 24 or newer and Bun:

```bash
bun install
bun run check
```

`bun run check` runs formatting, linting, type checking, the checkout-local
activation test, dependency analysis, the audit, and package validation.

Use the repository checkout configuration in `.opencode/opencode.jsonc` when
testing the local plugin source. The production entry point is
`plugins/mem0-bridge/index.ts`; `.opencode/index.ts` provides the local checkout
identity.

## Related documentation

- [Local Mem0 MCP server](https://github.com/mdc-git/mem0)
- [OpenCode V2 configuration](https://opencode.ai/v2/docs/config)
- [OpenCode V2 plugins](https://opencode.ai/v2/docs/build/plugins)
- [OpenCode V2 MCP servers](https://opencode.ai/v2/docs/mcp-servers)
