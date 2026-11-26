import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_IPC_TIMEOUT_SECONDS,
  MAX_IPC_TIMEOUT_SECONDS,
  getHttpTransportTimeouts,
  readIpcTimeoutSeconds,
} from './config.js';

test('readIpcTimeoutSeconds reads, clamps up to 3600s, and falls back to system default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-mcp-timeout-'));
  try {
    const missingPath = join(dir, 'missing.json');
    assert.equal(readIpcTimeoutSeconds(missingPath), DEFAULT_IPC_TIMEOUT_SECONDS);

    const cfgPath = join(dir, 'global.json');
    writeFileSync(cfgPath, JSON.stringify({ ipc_timeout_seconds: 600 }), 'utf-8');
    assert.equal(readIpcTimeoutSeconds(cfgPath), 600);

    writeFileSync(cfgPath, JSON.stringify({ ipc_timeout_seconds: 10 }), 'utf-8');
    assert.equal(readIpcTimeoutSeconds(cfgPath), DEFAULT_IPC_TIMEOUT_SECONDS);

    writeFileSync(cfgPath, JSON.stringify({ ipc_timeout_seconds: 9999 }), 'utf-8');
    assert.equal(readIpcTimeoutSeconds(cfgPath), MAX_IPC_TIMEOUT_SECONDS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getHttpTransportTimeouts applies 1:1 commandMs and confirm headroom directly from base timeout', () => {
  assert.deepEqual(getHttpTransportTimeouts(60), {
    commandMs: 60_000,
    confirmMs: 180_000,
  });
  assert.deepEqual(getHttpTransportTimeouts(30), {
    commandMs: 30_000,
    confirmMs: 150_000,
  });
  assert.deepEqual(getHttpTransportTimeouts(600), {
    commandMs: 600_000,
    confirmMs: 720_000,
  });
});
