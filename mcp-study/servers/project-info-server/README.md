# Project Info MCP Server study

This is a local-only minimal TypeScript MCP Server experiment for `AI-tools-lab`.

It defines one read-only Tool, `get_project_info`, which accepts an empty object and returns fixed JSON as both a text content block and `structuredContent`.

## Files

- `src/project-info-server.ts`: Server factory, schemas and Tool handler.
- `src/server.ts`: stdio entry point used by the OpenHands integration experiment.
- `src/experiment.ts`: in-process Client/Server harness using an injected `fetch`; it does not open a port or contact `http://test.local`.
- `package-lock.json`: npm dependency lock used by the verified experiments.

## Verified experiments

### Stage 6: TypeScript MCP Client/Server

The TypeScript protocol experiment completed successfully:

```text
TypeScript MCP Client
→ server/discover
→ tools/list
→ get_project_info
→ tools/call
→ CallToolResult
```

`npm install`, `npm run typecheck`, and `npm run experiment` all exited successfully. The Client discovered `get_project_info`, called it with an empty object, and verified the returned structured result.

### Stage 8: OpenHands Agent + MCP on Ubuntu

The cross-language Agent experiment also completed successfully on Ubuntu:

```text
OpenHands Agent / TestLLM
→ MCPToolDefinition
→ MCPToolAction / ActionEvent
→ Python FastMCP Client
→ TypeScript stdio MCP Server
→ get_project_info
→ MCPToolObservation / ObservationEvent
→ Conversation FINISHED
```

The tested environment used OpenHands SDK `1.54.0`, FastMCP `3.2.0`, Python `3.12.3`, and Node.js `24.18.0`. The result was `PASS` for this controlled integration path.

## Experiment limits and security boundary

- `get_project_info` accepts an empty object and returns fixed JSON; it does not read files, access the network, or read environment variables.
- `TestLLM` returned scripted responses, so this experiment did not test whether a real LLM can reliably select the Tool.
- No real LLM API, account, Token, Cookie, GitHub, Binance, or other external business API was used.
- The experiment covered one local stdio Server, one Tool, and one successful call. It did not validate multi-Server operation, retries, timeout handling, concurrency, production isolation, or a complete OpenHands deployment.
- A `FINISHED` Agent state proves only that this controlled Conversation completed successfully; it is not evidence that the Server or integration is production-ready.

The Server requires Node.js 20 or later and the dependencies locked in `package-lock.json`. Local `node_modules`, build output, caches, and raw experiment output are not source files and must not be committed.

Do not use the stdio entry point with an untrusted Host. Starting it executes a local process with the current user's permissions.
