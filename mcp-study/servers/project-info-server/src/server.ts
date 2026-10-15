import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { createProjectInfoServer } from './project-info-server.js';

void serveStdio(createProjectInfoServer);
console.error('project-info-study-server waiting on stdio');
