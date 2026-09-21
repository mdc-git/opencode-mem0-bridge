# OpenCode Mem0 Bridge

An OpenCode V2 server plugin that adds project-memory retrieval and optional
automatic memory extraction to the local [Mem0 MCP server](https://github.com/mdc-git/mem0).
The plugin retrieves the three most relevant memories for each latest user message
and appends them as untrusted reference context.
It also registers the `project-memory` skill programmatically.

## Requirements

- OpenCode V2
- The local Mem0 MCP server from `github.com/mdc-git/mem0`
- Local Ollama and Qdrant services started by that MCP server

The MCP server remains responsible for memory tools and persistence. This
repository provides the OpenCode bridge and skill only.

## Global GitHub installation

Add the Git package and MCP server to `$HOME/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-mem0-bridge@git+https://github.com/mdc-git/opencode-mem0-bridge.git"
  ],
  "mcp": {
    "servers": {
      "mem0": {
        "type": "local",
        "command": ["<MEM0_ROOT>/run.sh"],
        "environment": {
          "MEM0_PROFILE": "{env:MEM0_PROFILE}",
          "MEM0_EMBEDDING_MODEL": "{env:MEM0_EMBEDDING_MODEL}"
        }
      }
    }
  }
}
```

Replace `<MEM0_ROOT>` with the absolute path to the local Mem0 MCP server.
The `{env:NAME}` values tell OpenCode to copy environment variables from the
process that starts OpenCode. Set both variables before starting OpenCode,
using the same values used during Mem0 setup:

```bash
export MEM0_PROFILE=cpu
export MEM0_EMBEDDING_MODEL=qwen3-embedding:0.6b
opencode
```

Leave `MEM0_PROFILE` unset or set it to `cpu` for CPU-only execution. Set it to
`gpu` for GPU execution. If you do not want to export variables, replace the
`{env:...}` values with literal values such as `"cpu"` or `"gpu"` and
`"qwen3-embedding:0.6b"`. Any other profile value is invalid.

The plugin registers the `project-memory` skill through OpenCode's skill
registry; no separate `skills` configuration entry is required.

## Automatic extraction

Automatic extraction is disabled by default. Enable it with plugin options:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-mem0-bridge@git+https://github.com/mdc-git/opencode-mem0-bridge.git",
      "options": {
        "automaticExtraction": true,
        "extractionModel": "ollama/qwen3:8b"
      }
    }
  ]
}
```

`extractionModel` uses the `provider/model#variant` format. When it is omitted,
the triggering session model is used. The model receives the ordered user and
visible agent messages, tool parameters, and failed tool errors from the terminal
execution. Each evidence item is limited to 450 characters. Existing relevant
memories are supplied separately so the model can return `add` or `update`
operations. Mem0 stores those operations without its own LLM inference.

## Development

```sh
bun install
bun build plugins/mem0-bridge/index.ts --target bun --outfile /tmp/opencode-mem0-bridge.js
```
