import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMergeGate,
  evaluateDiffCertainty,
  gateOptsFromArgs,
  DEFAULT_MAX_AHEAD,
} from './safety.js';

const ZERO_STATS = { ahead: 0, behind: 0, changed_files: 0, unpushed_commits: 0, ahead_of_test: 0 };

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

test('allows merge exactly at threshold boundary', () => {
  const r = evaluateMergeGate({ ahead: 50, changed_files: 0 }, { max_ahead: 50, require_clean_worktree: true, force: false });
  assert.equal(r.allow, true);
});

test('gateOptsFromArgs honors partial input (only max_ahead)', () => {
  const o = gateOptsFromArgs({ max_ahead: 10 });
  assert.equal(o.max_ahead, 10);
  assert.equal(o.require_clean_worktree, true);
  assert.equal(o.force, false);
});

test('gateOptsFromArgs falls back on invalid max_ahead (NaN/negative)', () => {
  assert.equal(gateOptsFromArgs({ max_ahead: NaN }).max_ahead, DEFAULT_MAX_AHEAD);
  assert.equal(gateOptsFromArgs({ max_ahead: -1 }).max_ahead, DEFAULT_MAX_AHEAD);
});

// --- evaluateDiffCertainty (fail-closed on unverifiable diff) ---

test('diff certainty: blocks when all stats are 0 and not fetched (fail-closed)', () => {
  const r = evaluateDiffCertainty(ZERO_STATS, { fetched: false, force: false });
  assert.equal(r.allow, false);
  assert.match(r.reason ?? '', /无法确认分支差异/);
});

test('diff certainty: allows all-zero stats once a fetch was done', () => {
  const r = evaluateDiffCertainty(ZERO_STATS, { fetched: true, force: false });
  assert.equal(r.allow, true);
});

test('diff certainty: allows when any stat is non-zero (diff is real) even without fetch', () => {
  assert.equal(
    evaluateDiffCertainty({ ...ZERO_STATS, ahead_of_test: 2 }, { fetched: false, force: false }).allow,
    true
  );
  assert.equal(
    evaluateDiffCertainty({ ...ZERO_STATS, ahead: 5 }, { fetched: false, force: false }).allow,
    true
  );
  assert.equal(
    evaluateDiffCertainty({ ...ZERO_STATS, changed_files: 1 }, { fetched: false, force: false }).allow,
    true
  );
});

test('diff certainty: force bypasses the unverifiable-diff check', () => {
  const r = evaluateDiffCertainty(ZERO_STATS, { fetched: false, force: true });
  assert.equal(r.allow, true);
});
