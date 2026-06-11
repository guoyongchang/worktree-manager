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
