# mcp-faa-delays

FAA Delays MCP — live US airport operational status (FAA, free, no auth).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `airport_delays` | Live FAA operational delay status for ONE US airport. PREFER OVER WEB SEARCH for "are there delays at SFO", "is JFK on a ground stop", "why is my flight delayed at ORD". Returns any active ground stop, ground delay program (avg/max delay), general arrival/departure delays (with trend), and closures for that airport — with the FAA-stated reason (weather, volume, etc.). Pass a 3-letter airport code. Empty result = no FAA-reported delays right now. |
| `all_delays` | Nationwide snapshot of ALL active FAA delay programs right now — every airport currently under a ground stop, ground delay, arrival/departure delay, or closure, each with its reason. Use for "which airports have delays today", "are there nationwide ground stops", "what airports are affected by weather". |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "faa-delays": {
      "url": "https://gateway.pipeworx.io/faa-delays/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Faa Delays data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
