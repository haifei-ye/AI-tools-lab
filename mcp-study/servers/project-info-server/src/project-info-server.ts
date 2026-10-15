import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

export const PROJECT_INFO = {
  name: 'AI-tools-lab',
  module: 'mcp-study',
  stage: 5,
  purpose: 'Understand a minimal MCP Server and Tool call flow',
  dataSource: 'fixed-local-data'
} as const;

const projectInfoSchema = z.object({
  name: z.string(),
  module: z.string(),
  stage: z.number().int(),
  purpose: z.string(),
  dataSource: z.literal('fixed-local-data')
});

export function createProjectInfoServer(): McpServer {
  const server = new McpServer({
    name: 'project-info-study-server',
    version: '0.1.0'
  });

  server.registerTool(
    'get_project_info',
    {
      title: 'Get project information',
      description: 'Return fixed metadata for the local AI-tools-lab MCP study.',
      inputSchema: z.object({}),
      outputSchema: projectInfoSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(PROJECT_INFO)
        }
      ],
      structuredContent: PROJECT_INFO
    })
  );

  return server;
}
