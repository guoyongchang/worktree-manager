const STORAGE_KEY = 'wm_time_saved_v1';

/** Minutes a person would typically spend doing this by hand, once. */
const MINUTES_BY_OPERATION: Record<string, number> = {
  sync: 3,
  pull: 1,
  push: 1,
  mergeTest: 5,
  mergeBase: 5,
  refresh: 1,
  pr: 3,
  switchWorkspace: 1,
};

export interface TimeSavedStats {
  totalMinutes: number;
  counts: Record<string, number>;
  byDay: Record<string, number>;
  reposSkippedCheckout: number;
  workspaceProjects: number;
  gitOpsSaved: number;
  switchMinuteRule?: number;
  activityByDay?: Record<string, { create: number; archive: number; switch: number; merge: number }>;
}


export function todayKey(): string {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function readStatsRaw(): TimeSavedStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { totalMinutes: 0, counts: {}, byDay: {}, reposSkippedCheckout: 0, workspaceProjects: 0, gitOpsSaved: 0 };
    const parsed = JSON.parse(raw) as Partial<TimeSavedStats>;
    return {
      totalMinutes: typeof parsed.totalMinutes === 'number' ? parsed.totalMinutes : 0,
      counts: parsed.counts && typeof parsed.counts === 'object' ? parsed.counts : {},
      byDay: parsed.byDay && typeof parsed.byDay === 'object' ? parsed.byDay : {},
      activityByDay: parsed.activityByDay && typeof parsed.activityByDay === 'object' ? parsed.activityByDay : {},
      reposSkippedCheckout: typeof parsed.reposSkippedCheckout === 'number' ? parsed.reposSkippedCheckout : 0,
      workspaceProjects: typeof parsed.workspaceProjects === 'number' ? parsed.workspaceProjects : 0,
      gitOpsSaved: typeof parsed.gitOpsSaved === 'number' ? parsed.gitOpsSaved : 0,
      switchMinuteRule: typeof parsed.switchMinuteRule === 'number' ? parsed.switchMinuteRule : 0,
    };
  } catch {
    return { totalMinutes: 0, counts: {}, byDay: {}, activityByDay: {}, reposSkippedCheckout: 0, workspaceProjects: 0, gitOpsSaved: 0 };
  }
}

function readStatsNormalized(): TimeSavedStats {
  const stats = readStatsRaw();
  if (stats.switchMinuteRule === 1) return stats;
  const switches = stats.counts.switchWorkspace ?? 0;
  const excess = Math.max(0, stats.workspaceProjects - switches);
  if (excess > 0) {
    stats.totalMinutes = Math.max(0, stats.totalMinutes - excess);
    const today = todayKey();
    if (typeof stats.byDay[today] === 'number') {
      stats.byDay[today] = Math.max(0, stats.byDay[today] - excess);
    }
  }
  stats.switchMinuteRule = 1;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  return stats;
}

function readStats(): TimeSavedStats {
  return readStatsNormalized();
}

export type ActivityKind = 'create' | 'archive' | 'switch' | 'merge';

function emptyActivity() {
  return { create: 0, archive: 0, switch: 0, merge: 0 };
}

function bumpActivity(stats: TimeSavedStats, kind: ActivityKind): void {
  const day = todayKey();
  const activityByDay = stats.activityByDay ?? {};
  const current = activityByDay[day] ?? emptyActivity();
  current[kind] += 1;
  activityByDay[day] = current;
  stats.activityByDay = activityByDay;
}

export function recordActivity(kind: ActivityKind): void {
  const stats = readStats();
  bumpActivity(stats, kind);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  window.dispatchEvent(new Event('time-saved-changed'));
}

export function activityOn(stats: TimeSavedStats, day: string) {
  return stats.activityByDay?.[day] ?? emptyActivity();
}

function writeMinutes(operation: string, minutes: number): void {
  if (minutes <= 0) return;
  const stats = readStats();
  stats.counts[operation] = (stats.counts[operation] ?? 0) + 1;
  stats.totalMinutes += minutes;
  if (operation === 'mergeTest' || operation === 'mergeBase') {
    stats.gitOpsSaved += 5;
    bumpActivity(stats, 'merge');
  }
  const day = todayKey();
  stats.byDay[day] = (stats.byDay[day] ?? 0) + minutes;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  window.dispatchEvent(new Event('time-saved-changed'));
  scheduleUsageReport(stats, day);
}



let reportTimer = 0;

function scheduleUsageReport(stats: TimeSavedStats, day: string): void {
  clearTimeout(reportTimer);
  reportTimer = window.setTimeout(() => {
    const payload = {
      todayMinutes: stats.byDay[day] ?? 0,
      totalMinutes: stats.totalMinutes,
      counts: stats.counts,
    };
    void import('./backend')
      .then(async ({ reportTimeSaved }) => {
        const result = await reportTimeSaved(payload);
        if (!result.skipped) appendUsageReportLog(result);
      })
      .catch((err) => {
        appendUsageReportLog({
          request: payload,
          status: 0,
          response: err instanceof Error ? err.message : String(err),
        });
      });
  }, 3000);
}

const USAGE_LOG_KEY = 'wm_usage_report_log';

export interface UsageReportLogEntry {
  at: string;
  request: unknown;
  status: number;
  response: string;
}

export function readUsageReportLog(): UsageReportLogEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(USAGE_LOG_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendUsageReportLog(result: { request: unknown; status: number; response: string }): void {
  const next = [{ at: new Date().toISOString(), ...result }, ...readUsageReportLog()].slice(0, 20);
  localStorage.setItem(USAGE_LOG_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event('usage-report-log-changed'));
}

export function getTimeSaved(): TimeSavedStats {
  return readStats();
}

export function recordWorkspaceSwitch(_projectCount: number): void {
  const stats = readStats();
  bumpActivity(stats, 'switch');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  writeMinutes('switchWorkspace', 1);
}

const SAVED_ROW_ORDER = ['sync', 'pull', 'push', 'mergeTest', 'mergeBase', 'pr', 'switchBranch', 'switchWorkspace', 'refresh'] as const;

export function savedOperationRows(stats: TimeSavedStats): { id: string; count: number; minutes: number }[] {
  return SAVED_ROW_ORDER.flatMap((id) => {
    const count = stats.counts[id] ?? 0;
    if (count <= 0) return [];
    const minutes = count * (MINUTES_BY_OPERATION[id] ?? (id === 'switchWorkspace' ? 1 : 0));
    return [{ id, count, minutes }];
  });
}

export function savedGitCommands(stats: TimeSavedStats): Record<'checkout' | 'fetch' | 'pull' | 'merge' | 'push', number> {
  const merge = (stats.counts.mergeTest ?? 0) + (stats.counts.mergeBase ?? 0);
  return {
    checkout: (stats.counts.switchBranch ?? 0) + merge * 2,
    fetch: (stats.counts.sync ?? 0) + (stats.counts.refresh ?? 0) + merge,
    pull: stats.counts.pull ?? 0,
    merge: (stats.counts.sync ?? 0) + merge,
    push: (stats.counts.push ?? 0) + merge,
  };
}

export function repeatedOperationCount(stats: TimeSavedStats): number {
  return Object.values(stats.counts).reduce((sum, n) => sum + n, 0);
}
export function todaySavedMinutes(stats: TimeSavedStats = readStats()): number {
  return stats.byDay[todayKey()] ?? 0;
}

export function recordTimeSaved(operation: string): void {
  const minutes = MINUTES_BY_OPERATION[operation];
  if (!minutes) return;
  writeMinutes(operation, minutes);
}



/** One branch switch avoids one repo checkout. */
export function recordBranchSwitch(): void {
  const stats = readStats();
  stats.counts.switchBranch = (stats.counts.switchBranch ?? 0) + 1;
  stats.reposSkippedCheckout += 1;
  stats.totalMinutes += 1;
  const day = todayKey();
  stats.byDay[day] = (stats.byDay[day] ?? 0) + 1;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  window.dispatchEvent(new Event('time-saved-changed'));
  scheduleUsageReport(stats, day);
}

