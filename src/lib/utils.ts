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
export const GIT_BATCH_CONCURRENCY = 4;

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
