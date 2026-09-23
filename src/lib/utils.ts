import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalize path separators: collapse consecutive slashes (both / and \) into one.
 * On Windows, paths from Rust use backslashes; on Unix, forward slashes.
 * This ensures consistent parsing regardless of platform.
 */
export function normalizePath(path: string): string {
  return path.replace(/[/\\]+/g, '/');
}

/**
 * Get the last component of a path (basename), cross-platform safe.
 * Handles both / and \ separators.
 */
export function basename(path: string): string {
  const parts = normalizePath(path).split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Default fan-out for batched git operations (pull / sync / fetch across projects).
 * Kept small on purpose: dozens of simultaneous git processes trigger credential-helper
 * prompts and lock contention on Windows. Mirrors SYNC_ALL_MAX_CONCURRENT in the backend.
 */
export const GIT_BATCH_CONCURRENCY = 2;
/**
 * Fan-out for the read-only remote fetch sweep (sidebar refresh).
 * Matches SYNC_ALL_MAX_CONCURRENT: worktrees of the same repo share refs, so the
 * sweep already dedupes by project name. Higher fan-out mostly burns SSH slots.
 */
export const GIT_FETCH_CONCURRENCY = GIT_BATCH_CONCURRENCY;

type FetchableProject = { name: string; path: string };

/**
 * One fetch path per project name. Main-workspace checkout wins when present
 * (same git common dir as that project's worktrees).
 */
export function uniqueFetchProjectPaths(
  worktrees: ReadonlyArray<{ is_archived: boolean; projects: ReadonlyArray<FetchableProject> }>,
  mainWorkspace: { projects: ReadonlyArray<FetchableProject> } | null | undefined,
): string[] {
  const byName = new Map<string, string>();
  if (mainWorkspace) {
    for (const project of mainWorkspace.projects) {
      if (project.name && project.path) {
        byName.set(project.name, project.path);
      }
    }
  }
  for (const worktree of worktrees) {
    if (worktree.is_archived) continue;
    for (const project of worktree.projects) {
      if (project.name && project.path && !byName.has(project.name)) {
        byName.set(project.name, project.path);
      }
    }
  }
  return [...byName.values()];
}

/**
 * Run `fn` over `items` with at most `limit` promises in flight at once.
 * Like Promise.allSettled: never throws, results are returned in input order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const effectiveLimit = Math.max(1, Math.floor(limit) || 1);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(effectiveLimit, items.length) }, worker));
  return results;
}
