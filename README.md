# OpenCode Mem0 Bridge

An OpenCode V2 server plugin that adds automatic project-memory retrieval to the
local [Mem0 MCP server](https://github.com/mdc-git/mem0). The plugin retrieves the
three most relevant memories for each latest user message and appends them as
untrusted reference context.
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
        "cwd": "<MEM0_ROOT>"
      }
    }
  }
}
```

Replace `<MEM0_ROOT>` with the absolute path to the local Mem0 MCP server.
Shell variables are not expanded inside the `command` or `cwd` values.

The plugin registers the `project-memory` skill through OpenCode's skill
registry; no separate `skills` configuration entry is required.

## Development

```sh
bun install
bun build plugins/mem0-bridge/index.ts --target bun --outfile /tmp/opencode-mem0-bridge.js
```
