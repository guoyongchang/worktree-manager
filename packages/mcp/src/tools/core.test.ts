import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveActiveWorkspace } from './core.js';

const workspace = { name: 'scm', path: '/work/scm', worktrees_dir: 'worktrees' };

test('worktree root is the requirement directory, not a project', () => {
  const found = deriveActiveWorkspace('/work/scm/worktrees/feature-pay', [workspace]);
  assert.equal(found.worktree_name, 'feature-pay');
  assert.equal(found.project_name, null);
  assert.equal(found.recommended_cwd, '/work/scm/worktrees/feature-pay');
  assert.equal(found.open_at_root, true);
  assert.equal(found.guidance, null);
});

test('a project subdirectory is recognized but not the recommended open path', () => {
  const found = deriveActiveWorkspace('/work/scm/worktrees/feature-pay/projects/api', [workspace]);
  assert.equal(found.worktree_name, 'feature-pay');
  assert.equal(found.project_name, 'api');
  assert.equal(found.open_at_root, false);
  assert.match(found.guidance ?? '', /feature-pay/);
});

test('main workspace projects are not a requirement worktree', () => {
  const found = deriveActiveWorkspace('/work/scm/projects/api', [workspace]);
  assert.equal(found.worktree_name, null);
  assert.equal(found.recommended_cwd, '/work/scm');
  assert.equal(found.open_at_root, false);
});

test('custom worktrees_dir is used', () => {
  const found = deriveActiveWorkspace('/work/scm/trees/hotfix', [{ ...workspace, worktrees_dir: 'trees' }]);
  assert.equal(found.worktree_name, 'hotfix');
  assert.equal(found.open_at_root, true);
});
