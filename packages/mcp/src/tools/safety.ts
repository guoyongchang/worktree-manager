import type { MergeGateOpts } from '../types.js';

export const DEFAULT_MAX_AHEAD = 50;

export interface MergeGateInput {
  ahead: number;          // 领先目标分支的提交数（merge_to_test 用 ahead_of_test，merge_to_base 用 ahead）
  changed_files: number;  // 工作区未提交变更文件数
}

export interface MergeGateResult {
  allow: boolean;
  reason?: string;
}

// 纯函数：判断合并是否放行（"数量不大"护栏）
export function evaluateMergeGate(input: MergeGateInput, opts: MergeGateOpts): MergeGateResult {
  if (opts.force) return { allow: true };
  if (opts.require_clean_worktree && input.changed_files > 0) {
    return {
      allow: false,
      reason: `工作区有 ${input.changed_files} 个未提交变更，请先提交或 stash（确属预期可传 force:true 跳过）`,
    };
  }
  if (input.ahead > opts.max_ahead) {
    return {
      allow: false,
      reason: `领先目标分支 ${input.ahead} 个提交，超过阈值 ${opts.max_ahead}，疑似分支选错或需人工确认（确属预期可传 force:true）`,
    };
  }
  return { allow: true };
}

// 从工具入参解析门控选项
export function gateOptsFromArgs(args: Record<string, unknown>): MergeGateOpts {
  const n = args?.max_ahead;
  return {
    max_ahead: typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_AHEAD,
    require_clean_worktree: args?.require_clean_worktree !== false,
    force: args?.force === true,
  };
}
