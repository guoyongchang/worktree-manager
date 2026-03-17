#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(projectRoot, 'src');
const backendPath = path.join(projectRoot, 'src', 'lib', 'backend.ts');
const ipcPath = path.join(projectRoot, 'src-tauri', 'src', 'lib.rs');
const httpPaths = [
  path.join(projectRoot, 'src-tauri', 'src', 'http_server.rs'),
  path.join(projectRoot, 'src-tauri', 'src', 'http_server', 'routing.rs'),
];
const docsPath = path.join(projectRoot, 'docs', 'generated', 'command-contracts.md');

const mode = process.argv[2] || 'check';

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function toSortedSet(values) {
  return [...new Set(values)].sort();
}

function lineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

function addUsage(map, key, usage) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(usage);
}

function uniq(values) {
  return [...new Set(values)];
}

function diff(source, target) {
  const targetSet = new Set(target);
  return source.filter((item) => !targetSet.has(item));
}

function formatFrontendUsage(usage) {
  return `${usage.file}:${usage.line}`;
}

function formatBackendEndpointUsage(usage) {
  return `${usage.functionName}() @ ${usage.file}:${usage.line}`;
}

function collectExportedFunctions(content) {
  const functions = [];
  const functionRegex = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;

  for (const match of content.matchAll(functionRegex)) {
    functions.push({
      name: match[1],
      index: match.index,
      line: lineNumber(content, match.index),
    });
  }

  return functions.sort((a, b) => a.index - b.index);
}

function findNearestFunction(functions, index) {
  let current = null;
  for (const item of functions) {
    if (item.index > index) break;
    current = item;
  }
  return current;
}

function extractFrontendCommands() {
  const files = walk(srcRoot);
  const commands = [];
  const usages = new Map();
  const commandRegex = /callBackend(?:<[^>]+>)?\(\s*['"]([a-z0-9_]+)['"]/g;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const match of content.matchAll(commandRegex)) {
      const command = match[1];
      commands.push(command);
      addUsage(usages, command, {
        file: path.relative(projectRoot, filePath),
        line: lineNumber(content, match.index),
      });
    }
  }

  return {
    commands: toSortedSet(commands),
    usages,
  };
}

function extractBackendHttpEndpoints() {
  const content = fs.readFileSync(backendPath, 'utf8');
  const functions = collectExportedFunctions(content);
  const endpointRegex = /fetch\(\s*`\$\{getApiBase\(\)\}\/([^`]+)`/g;
  const usages = new Map();
  const endpoints = [];

  for (const match of content.matchAll(endpointRegex)) {
    const endpoint = match[1];
    if (endpoint.includes('${')) {
      continue;
    }

    const owner = findNearestFunction(functions, match.index);
    if (owner?.name === 'callBackend') {
      continue;
    }

    const nearby = content.slice(match.index, match.index + 500);
    const methodMatch = nearby.match(/method:\s*['"]([A-Z]+)['"]/i);
    const method = (methodMatch?.[1] || 'GET').toUpperCase();

    endpoints.push(endpoint);
    addUsage(usages, endpoint, {
      file: path.relative(projectRoot, backendPath),
      functionName: owner?.name || '(unknown)',
      line: lineNumber(content, match.index),
      method,
    });
  }

  return {
    endpoints: toSortedSet(endpoints),
    usages,
  };
}

function extractIpcCommands() {
  const content = fs.readFileSync(ipcPath, 'utf8');
  const match = content.match(/generate_handler!\[(?<body>[\s\S]*?)\]\)/);
  if (!match?.groups?.body) {
    throw new Error('Failed to locate tauri::generate_handler! block in src-tauri/src/lib.rs');
  }

  const cleaned = match.groups.body
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  return {
    commands: toSortedSet(
      cleaned
        .split(',')
        .map((part) => part.trim())
        .filter((part) => /^[a-z_][a-z0-9_]*$/i.test(part)),
    ),
  };
}

function extractHttpRoutes() {
  const routes = new Map();
  const endpoints = [];
  const routeRegex = /\.route\(\s*"\/api\/([^"]+)"\s*,\s*(get|post)\(\s*([A-Za-z0-9_]+)\s*\)\s*,?\s*\)/g;

  for (const httpPath of httpPaths) {
    if (!fs.existsSync(httpPath)) {
      continue;
    }

    const content = fs.readFileSync(httpPath, 'utf8');
    for (const match of content.matchAll(routeRegex)) {
      const endpoint = match[1];
      endpoints.push(endpoint);
      addUsage(routes, endpoint, {
        file: path.relative(projectRoot, httpPath),
        handler: match[3],
        line: lineNumber(content, match.index),
        method: match[2].toUpperCase(),
      });
    }
  }

  return {
    endpoints: toSortedSet(endpoints),
    routes,
  };
}

function classifyHttpEndpoint(endpoint, backendHttpOnlySet) {
  if (backendHttpOnlySet.has(endpoint)) {
    return 'backend-http-only';
  }
  if (endpoint.includes('/') || endpoint.includes('.')) {
    return 'infra-http-only';
  }
  return 'mirrored-command';
}

function firstRouteInfo(routeEntries) {
  return routeEntries?.[0] || null;
}

function writeDocs(frontend, backendHttpOnly, ipc, http) {
  const backendHttpOnlySet = new Set(backendHttpOnly.endpoints);
  const mirroredHttpEndpoints = toSortedSet(
    http.endpoints.filter((endpoint) => classifyHttpEndpoint(endpoint, backendHttpOnlySet) === 'mirrored-command'),
  );
  const mirroredCommands = toSortedSet([
    ...frontend.commands,
    ...ipc.commands,
    ...mirroredHttpEndpoints,
  ]);
  const auxiliaryHttpEndpoints = toSortedSet(
    http.endpoints.filter((endpoint) => classifyHttpEndpoint(endpoint, backendHttpOnlySet) !== 'mirrored-command'),
  );

  const lines = [
    '# Command Contracts',
    '',
    `Generated on ${new Date().toISOString()}.`,
    '',
    'This file is generated by `scripts/command-contracts.mjs`.',
    'Route scanning includes both `src-tauri/src/http_server.rs` and `src-tauri/src/http_server/routing.rs`.',
    '',
    '## Summary',
    '',
    `- Frontend \`callBackend()\` usages: ${frontend.commands.length}`,
    `- backend.ts direct HTTP endpoints: ${backendHttpOnly.endpoints.length}`,
    `- Tauri IPC commands: ${ipc.commands.length}`,
    `- HTTP API routes: ${http.endpoints.length}`,
    '',
    '## Mirrored Command Matrix',
    '',
    '| Command | Frontend | IPC | HTTP | Method | Handler |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const command of mirroredCommands) {
    const routeEntries = http.routes.get(command) || [];
    const methods = uniq(routeEntries.map((item) => item.method)).join(', ');
    const handlers = uniq(routeEntries.map((item) => `\`${item.handler}\``)).join(', ');
    lines.push(
      `| \`${command}\` | ${frontend.commands.includes(command) ? 'yes' : ''} | ${ipc.commands.includes(command) ? 'yes' : ''} | ${routeEntries.length ? 'yes' : ''} | ${methods} | ${handlers} |`,
    );
  }

  lines.push('', '## HTTP-only Endpoints', '', '| Endpoint | Source | Method | Handler | Kind |', '| --- | --- | --- | --- | --- |');

  if (auxiliaryHttpEndpoints.length === 0) {
    lines.push('| _none_ |  |  |  |  |');
  } else {
    for (const endpoint of auxiliaryHttpEndpoints) {
      const routeInfo = firstRouteInfo(http.routes.get(endpoint));
      const backendUsage = backendHttpOnly.usages.get(endpoint) || [];
      const source = backendUsage.length
        ? backendUsage.map((item) => `\`${formatBackendEndpointUsage(item)}\``).join('<br>')
        : routeInfo
          ? `\`${routeInfo.file}:${routeInfo.line}\``
          : '';
      const kind = classifyHttpEndpoint(endpoint, backendHttpOnlySet) === 'backend-http-only'
        ? 'backend.ts direct fetch'
        : 'HTTP infrastructure';
      lines.push(
        `| \`${endpoint}\` | ${source} | ${routeInfo?.method || ''} | ${routeInfo ? `\`${routeInfo.handler}\`` : ''} | ${kind} |`,
      );
    }
  }

  const sections = [
    ['Frontend missing IPC', diff(frontend.commands, ipc.commands), frontend.usages, formatFrontendUsage],
    ['Frontend missing HTTP', diff(frontend.commands, http.endpoints), frontend.usages, formatFrontendUsage],
    ['backend.ts HTTP-only endpoints missing HTTP route', diff(backendHttpOnly.endpoints, http.endpoints), backendHttpOnly.usages, formatBackendEndpointUsage],
    ['IPC missing HTTP route', diff(ipc.commands, http.endpoints), null, null],
    ['HTTP mirrored routes missing IPC command', diff(mirroredHttpEndpoints, ipc.commands), http.routes, (usage) => `${usage.file}:${usage.line}`],
  ];

  for (const [title, items, usageMap, formatter] of sections) {
    lines.push('', `## ${title}`, '');
    if (items.length === 0) {
      lines.push('- None');
      continue;
    }

    for (const item of items) {
      if (!usageMap || !formatter) {
        lines.push(`- \`${item}\``);
        continue;
      }

      const usages = usageMap.get(item) || [];
      const rendered = usages.map((usage) => formatter(usage)).join(', ');
      lines.push(rendered ? `- \`${item}\` - ${rendered}` : `- \`${item}\``);
    }
  }

  fs.mkdirSync(path.dirname(docsPath), { recursive: true });
  fs.writeFileSync(docsPath, `${lines.join('\n')}\n`);
}

function reportDiffs(frontend, backendHttpOnly, ipc, http) {
  const backendHttpOnlySet = new Set(backendHttpOnly.endpoints);
  const mirroredHttpEndpoints = http.endpoints.filter(
    (endpoint) => classifyHttpEndpoint(endpoint, backendHttpOnlySet) === 'mirrored-command',
  );
  const mismatches = [
    ['Frontend -> IPC', diff(frontend.commands, ipc.commands)],
    ['Frontend -> HTTP', diff(frontend.commands, http.endpoints)],
    ['backend.ts HTTP-only -> HTTP', diff(backendHttpOnly.endpoints, http.endpoints)],
    ['IPC -> HTTP', diff(ipc.commands, http.endpoints)],
    ['HTTP mirrored -> IPC', diff(mirroredHttpEndpoints, ipc.commands)],
  ];

  let failed = false;
  for (const [label, items] of mismatches) {
    if (items.length === 0) {
      continue;
    }
    failed = true;
    console.error(`${label} mismatch (${items.length}): ${items.join(', ')}`);
  }
  return failed;
}

const frontend = extractFrontendCommands();
const backendHttpOnly = extractBackendHttpEndpoints();
const ipc = extractIpcCommands();
const http = extractHttpRoutes();

if (mode === 'generate') {
  writeDocs(frontend, backendHttpOnly, ipc, http);
  console.log(`Generated ${path.relative(projectRoot, docsPath)}`);
  process.exit(0);
}

if (mode === 'check') {
  const failed = reportDiffs(frontend, backendHttpOnly, ipc, http);
  if (failed) {
    console.error('');
    console.error('Run `npm run docs:contracts` after fixing mismatches to refresh the command matrix.');
    process.exit(1);
  }
  console.log('Command contracts are in sync.');
  process.exit(0);
}

console.error(`Unknown mode: ${mode}`);
process.exit(1);
