import type { BranchDiffStats, MergeGateOpts } from '../types.js';

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

export interface DiffCertaintyOpts {
  fetched: boolean; // 本次是否已执行 fetch（fetch_first），刷新过本地 ref
  force: boolean;
}

// 后端 BranchDiffStats 无法区分「无法计算 diff」（目标/base ref 不存在或未 fetch → 全 0）
// 与「确实无差异」（也是全 0）。若直接放行会 fail-open：把「算不出」误判为「差异为 0」。
// 保守策略（fail-closed）：所有 stats 均为 0 时视为「不确定」，除非本次已 fetch（fetched=true）
// 或显式 force，否则拒绝合并并提示用户先 fetch_first / sync。
export function evaluateDiffCertainty(
  stats: BranchDiffStats,
  opts: DiffCertaintyOpts
): MergeGateResult {
  if (opts.force) return { allow: true };
  const allZero =
    stats.ahead === 0 &&
    stats.behind === 0 &&
    stats.changed_files === 0 &&
    stats.unpushed_commits === 0 &&
    stats.ahead_of_test === 0;
  if (allZero && !opts.fetched) {
    return {
      allow: false,
      reason:
        '无法确认分支差异：所有 diff 统计均为 0，可能是目标分支/base 的 ref 未 fetch 或不存在（后端无法区分「算不出」与「确实无差异」）。请带 fetch_first:true 重试，或先手动 fetch/sync 后再合并（确属预期可传 force:true 跳过）',
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
