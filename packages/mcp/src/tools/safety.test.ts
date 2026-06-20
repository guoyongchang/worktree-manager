import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMergeGate, gateOptsFromArgs, DEFAULT_MAX_AHEAD } from './safety.js';

test('allows merge under threshold with clean worktree', () => {
  const r = evaluateMergeGate({ ahead: 3, changed_files: 0 }, { max_ahead: 50, require_clean_worktree: true, force: false });
  assert.equal(r.allow, true);
});

test('blocks when ahead exceeds threshold', () => {
  const r = evaluateMergeGate({ ahead: 99, changed_files: 0 }, { max_ahead: 50, require_clean_worktree: true, force: false });
  assert.equal(r.allow, false);
  assert.match(r.reason ?? '', /阈值/);
});

test('blocks on dirty worktree when require_clean_worktree', () => {
  const r = evaluateMergeGate({ ahead: 1, changed_files: 4 }, { max_ahead: 50, require_clean_worktree: true, force: false });
  assert.equal(r.allow, false);
  assert.match(r.reason ?? '', /未提交/);
});

test('force bypasses all gates', () => {
  const r = evaluateMergeGate({ ahead: 999, changed_files: 9 }, { max_ahead: 50, require_clean_worktree: true, force: true });
  assert.equal(r.allow, true);
});

test('gateOptsFromArgs applies defaults', () => {
  const o = gateOptsFromArgs({});
  assert.equal(o.max_ahead, DEFAULT_MAX_AHEAD);
  assert.equal(o.require_clean_worktree, true);
  assert.equal(o.force, false);
});

test('gateOptsFromArgs honors overrides', () => {
  const o = gateOptsFromArgs({ max_ahead: 10, require_clean_worktree: false, force: true });
  assert.deepEqual(o, { max_ahead: 10, require_clean_worktree: false, force: true });
});
