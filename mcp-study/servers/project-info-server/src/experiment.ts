import assert from 'node:assert/strict';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';

import { PROJECT_INFO, createProjectInfoServer } from './project-info-server.js';

const handler = createMcpHandler(createProjectInfoServer);
const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
  fetch: (url, init) => handler.fetch(new Request(url, init))
});
const client = new Client(
  { name: 'project-info-study-client', version: '0.1.0' },
  { versionNegotiation: { mode: 'auto' } }
);

try {
  await client.connect(transport);

  const listed = await client.listTools();
  const projectInfoTool = listed.tools.find(tool => tool.name === 'get_project_info');
  assert.ok(projectInfoTool, 'get_project_info must be discoverable through tools/list');

  const result = await client.callTool({
    name: 'get_project_info',
    arguments: {}
  });

  assert.notEqual(result.isError, true);
  assert.deepStrictEqual(result.structuredContent, PROJECT_INFO);

  console.log(
    JSON.stringify(
      {
        protocolVersion: client.getNegotiatedProtocolVersion(),
        protocolEra: client.getProtocolEra(),
        serverCapabilities: client.getServerCapabilities(),
        tools: listed.tools,
        callResult: result
      },
      null,
      2
    )
  );
} finally {
  await client.close();
  await handler.close();
}
