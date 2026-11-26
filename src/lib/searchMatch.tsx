import type { ReactNode } from 'react';
import { pinyin } from 'pinyin-pro';

export interface TextRange {
  index: number;
  length: number;
}

export type TextMatchResult =
  | { matched: false }
  | { matched: true; type: 'substring'; index: number; length: number; ranges?: TextRange[] }
  | { matched: true; type: 'pinyin' };

export function splitSearchTerms(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/).filter(Boolean);
}

function matchSingleTerm(text: string, term: string): TextMatchResult {
  if (!term) return { matched: false };
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();

  // 1. Direct case-insensitive substring
  const idx = lowerText.indexOf(lowerTerm);
  if (idx !== -1) {
    return { matched: true, type: 'substring', index: idx, length: lowerTerm.length };
  }

  // 2. Full pinyin & initials (for Chinese text)
  try {
    const fullPy = pinyin(text, { toneType: 'none', type: 'array' }).join('').toLowerCase();
    if (fullPy.includes(lowerTerm)) {
      return { matched: true, type: 'pinyin' };
    }
    const initials = pinyin(text, { pattern: 'initial', type: 'array' }).join('').toLowerCase();
    if (initials.includes(lowerTerm)) {
      return { matched: true, type: 'pinyin' };
    }
  } catch {
    // pinyin conversion failed for non-Chinese text, skip
  }

  return { matched: false };
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.index - b.index || b.length - a.length);
  const merged: TextRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    const lastEnd = last.index + last.length;
    const curEnd = cur.index + cur.length;
    if (cur.index <= lastEnd) {
      last.length = Math.max(lastEnd, curEnd) - last.index;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

export function matchText(text: string, query: string): TextMatchResult {
  const terms = splitSearchTerms(query);
  if (terms.length === 0) return { matched: false };
  if (terms.length === 1) {
    return matchSingleTerm(text, terms[0]);
  }

  // Prefer direct match of the full trimmed phrase when present
  const trimmed = query.trim();
  const directIdx = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (directIdx !== -1) {
    return { matched: true, type: 'substring', index: directIdx, length: trimmed.length };
  }

  const ranges: TextRange[] = [];
  for (const term of terms) {
    const res = matchSingleTerm(text, term);
    if (!res.matched) return { matched: false };
    if (res.type === 'substring') {
      ranges.push({ index: res.index, length: res.length });
    }
  }

  if (ranges.length === 0) {
    return { matched: true, type: 'pinyin' };
  }
  const merged = mergeRanges(ranges);
  return {
    matched: true,
    type: 'substring',
    index: merged[0].index,
    length: merged[0].length,
    ...(merged.length > 1 ? { ranges: merged } : {}),
  };
}

/**
 * Highlight whichever search terms match a single field (used for cross-field AND queries
 * where one term matches the tag/branch and another matches the project name).
 */
export function matchAnyTerm(text: string, terms: string[]): TextMatchResult {
  if (terms.length === 0) return { matched: false };
  const ranges: TextRange[] = [];
  let matchedPinyin = false;
  for (const term of terms) {
    const res = matchSingleTerm(text, term);
    if (!res.matched) continue;
    if (res.type === 'substring') {
      ranges.push({ index: res.index, length: res.length });
    } else {
      matchedPinyin = true;
    }
  }
  if (ranges.length > 0) {
    const merged = mergeRanges(ranges);
    return {
      matched: true,
      type: 'substring',
      index: merged[0].index,
      length: merged[0].length,
      ...(merged.length > 1 ? { ranges: merged } : {}),
    };
  }
  return matchedPinyin ? { matched: true, type: 'pinyin' } : { matched: false };
}

export function highlightText(text: string, result: TextMatchResult): ReactNode {
  if (!result.matched) return text;
  if (result.type === 'pinyin') {
    return (
      <span className="text-[var(--color-warning)] bg-[var(--color-warning)]/30 rounded-sm px-px">{text}</span>
    );
  }
  const ranges = result.ranges && result.ranges.length > 0
    ? result.ranges
    : [{ index: result.index, length: result.length }];
  if (ranges.length === 1) {
    const { index, length } = ranges[0];
    return (
      <>
        {text.slice(0, index)}
        <span className="text-[var(--color-warning)] bg-[var(--color-warning)]/30 rounded-sm px-px">
          {text.slice(index, index + length)}
        </span>
        {text.slice(index + length)}
      </>
    );
  }
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.index > cursor) {
      parts.push(text.slice(cursor, range.index));
    }
    parts.push(
      <span
        key={`${range.index}-${range.length}`}
        className="text-[var(--color-warning)] bg-[var(--color-warning)]/30 rounded-sm px-px"
      >
        {text.slice(range.index, range.index + range.length)}
      </span>
    );
    cursor = range.index + range.length;
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return <>{parts}</>;
}
