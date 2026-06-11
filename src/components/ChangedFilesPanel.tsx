import { useState, useEffect, useRef, useCallback, useMemo, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { getChangedFiles, getFileDiff } from '@/lib/backend';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronIcon, FolderIcon, LogIcon, RefreshIcon } from '@/components/Icons';
import type { ChangedFile, FileDiff, ProjectStatus } from '../types';

// ==================== Status helpers ====================

const STATUS_COLORS: Record<string, string> = {
    M: 'text-[var(--color-warning)]',
    A: 'text-[var(--color-success)]',
    D: 'text-[var(--color-error)]',
    R: 'text-[var(--color-accent)]',
    C: 'text-[var(--color-accent)]',
    '?': 'text-[var(--color-text-muted)]',
};

const STATUS_LABELS: Record<string, string> = {
    M: 'Modified',
    A: 'Added',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    '?': 'Untracked',
};

const STATUS_BG: Record<string, string> = {
    M: 'bg-amber-500/10 border-amber-500/30',
    A: 'bg-emerald-500/10 border-emerald-500/30',
    D: 'bg-[var(--color-error)]/10 border-[var(--color-error)]/30',
    R: 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]/30',
    C: 'bg-sky-500/10 border-sky-500/30',
    '?': 'bg-[var(--color-text-muted)]/10 border-[var(--color-text-muted)]/30',
};

const STATUS_ORDER = ['M', 'A', 'D', 'R', 'C', '?'] as const;
type ChangedFileEntry = ChangedFile & { projectName: string };
const CHANGED_FILE_MEMORY_KEY = 'worktree-manager.changed-files.last-selection.v1';
const LARGE_DIFF_THRESHOLD = 400;
const DIFF_CONTEXT_LINES = 3;

function readSelectionMemory(): Record<string, string> {
    if (typeof window === 'undefined') return {};
    try {
        const raw = window.localStorage.getItem(CHANGED_FILE_MEMORY_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function readRememberedSelection(reviewKey: string): string | null {
    return readSelectionMemory()[reviewKey] ?? null;
}

function writeRememberedSelection(reviewKey: string, fileKey: string): void {
    if (typeof window === 'undefined') return;
    try {
        const next = readSelectionMemory();
        next[reviewKey] = fileKey;
        window.localStorage.setItem(CHANGED_FILE_MEMORY_KEY, JSON.stringify(next));
    } catch {
        // ignore storage failures
    }
}

function buildExpandedPathSet(files: ChangedFileEntry[]): Set<string> {
    const paths = new Set<string>();
    for (const file of files) {
        const parts = [file.projectName, ...file.path.split(/[/\\]/)];
        for (let i = 1; i < parts.length; i++) {
            paths.add(parts.slice(0, i).join('/'));
        }
    }
    return paths;
}

function countStatuses(files: ChangedFileEntry[]): Record<string, number> {
    return files.reduce<Record<string, number>>((acc, file) => {
        acc[file.status] = (acc[file.status] || 0) + 1;
        return acc;
    }, {});
}

type DiffRow =
    | { type: 'pair'; pair: DiffPair }
    | { type: 'gap'; hiddenCount: number };

function buildChangedOnlyRows(pairs: DiffPair[], contextLines: number): DiffRow[] {
    const changedIndices = pairs
        .map((pair, index) => {
            const changed = pair.left.type !== 'same' || pair.right.type !== 'same';
            return changed ? index : -1;
        })
        .filter((index) => index >= 0);

    if (changedIndices.length === 0) {
        return pairs.map((pair) => ({ type: 'pair', pair }));
    }

    const ranges: Array<{ start: number; end: number }> = [];
    for (const index of changedIndices) {
        const start = Math.max(0, index - contextLines);
        const end = Math.min(pairs.length - 1, index + contextLines);
        const previous = ranges[ranges.length - 1];
        if (!previous || start > previous.end + 1) {
            ranges.push({ start, end });
        } else {
            previous.end = Math.max(previous.end, end);
        }
    }

    const rows: DiffRow[] = [];
    let cursor = 0;
    for (const range of ranges) {
        if (range.start > cursor) {
            rows.push({ type: 'gap', hiddenCount: range.start - cursor });
        }
        for (let index = range.start; index <= range.end; index++) {
            rows.push({ type: 'pair', pair: pairs[index] });
        }
        cursor = range.end + 1;
    }

    if (cursor < pairs.length) {
        rows.push({ type: 'gap', hiddenCount: pairs.length - cursor });
    }

    return rows;
}

// ==================== Tree builder ====================

interface TreeNode {
    name: string;
    path: string;
    children: Map<string, TreeNode>;
    file?: ChangedFileEntry;
    expanded: boolean;
}

function buildTree(
    files: ChangedFileEntry[]
): TreeNode {
    const root: TreeNode = {
        name: '',
        path: '',
        children: new Map(),
        expanded: true,
    };

    for (const file of files) {
        const parts = [file.projectName, ...file.path.split(/[/\\]/)];
        let current = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isFile = i === parts.length - 1;

            if (!current.children.has(part)) {
                current.children.set(part, {
                    name: part,
                    path: parts.slice(0, i + 1).join('/'),
                    children: new Map(),
                    expanded: true,
                });
            }

            const node = current.children.get(part)!;
            if (isFile) {
                node.file = file;
            }
            current = node;
        }
    }

    // Collapse single-child directory chains (GitLab-style)
    collapseTree(root);
    return root;
}

/**
 * Recursively merges single-child directory chains.
 * e.g., src -> main -> java -> com  becomes  src/main/java/com
 * Keeps project root nodes (depth 1) separate for clarity.
 */
function collapseTree(node: TreeNode): void {
    for (const [, child] of node.children) {
        collapseTree(child);
    }

    // Merge: if this node is a directory with exactly one child that is also a
    // directory (not a file), merge the child into this node.
    if (!node.file && node.children.size === 1) {
        const [, onlyChild] = Array.from(node.children.entries())[0];
        if (!onlyChild.file && onlyChild.children.size > 0) {
            // Don't collapse project root into the virtual root
            if (node.path === '') return;
            node.name = `${node.name}/${onlyChild.name}`;
            node.path = onlyChild.path;
            node.children = onlyChild.children;
        }
    }
}

// ==================== Diff computation ====================

interface DiffLine {
    type: 'same' | 'add' | 'remove' | 'empty';
    content: string;
    oldLine?: number;
    newLine?: number;
}

interface DiffPair {
    left: DiffLine;
    right: DiffLine;
}

function computeSideBySideDiff(oldText: string, newText: string): DiffPair[] {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    // Simple LCS-based diff
    const m = oldLines.length;
    const n = newLines.length;

    // For large files, use a simpler approach
    if (m + n > 5000) {
        return simpleDiff(oldLines, newLines);
    }

    // Build LCS table
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
        new Array(n + 1).fill(0)
    );
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to find diff
    let i = m, j = n;
    const tempPairs: DiffPair[] = [];

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            tempPairs.push({
                left: { type: 'same', content: oldLines[i - 1], oldLine: i },
                right: { type: 'same', content: newLines[j - 1], newLine: j },
            });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            tempPairs.push({
                left: { type: 'empty', content: '' },
                right: { type: 'add', content: newLines[j - 1], newLine: j },
            });
            j--;
        } else {
            tempPairs.push({
                left: { type: 'remove', content: oldLines[i - 1], oldLine: i },
                right: { type: 'empty', content: '' },
            });
            i--;
        }
    }

    tempPairs.reverse();
    return tempPairs;
}

function simpleDiff(oldLines: string[], newLines: string[]): DiffPair[] {
    const pairs: DiffPair[] = [];
    const maxLen = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
        const oldLine = i < oldLines.length ? oldLines[i] : undefined;
        const newLine = i < newLines.length ? newLines[i] : undefined;

        if (oldLine === newLine) {
            pairs.push({
                left: { type: 'same', content: oldLine!, oldLine: i + 1 },
                right: { type: 'same', content: newLine!, newLine: i + 1 },
            });
        } else if (oldLine !== undefined && newLine !== undefined) {
            pairs.push({
                left: { type: 'remove', content: oldLine, oldLine: i + 1 },
                right: { type: 'add', content: newLine, newLine: i + 1 },
            });
        } else if (oldLine !== undefined) {
            pairs.push({
                left: { type: 'remove', content: oldLine, oldLine: i + 1 },
                right: { type: 'empty', content: '' },
            });
        } else {
            pairs.push({
                left: { type: 'empty', content: '' },
                right: { type: 'add', content: newLine!, newLine: i + 1 },
            });
        }
    }

    return pairs;
}

// ==================== FileTreeItem ====================

const FileTreeItem: FC<{
    node: TreeNode;
    depth: number;
    selectedFile: string | null;
    onSelect: (projectName: string, filePath: string, key: string) => void;
    expandedPaths: Set<string>;
    onToggleExpand: (path: string) => void;
}> = ({ node, depth, selectedFile, onSelect, expandedPaths, onToggleExpand }) => {
    const isFile = !!node.file;
    const hasChildren = node.children.size > 0;
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = selectedFile === node.path;

    if (isFile) {
        const file = node.file!;
        return (
            <button
                data-file-key={node.path}
                className={`w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs transition-colors rounded-sm ${isSelected
                    ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                    : 'hover:bg-[var(--color-bg-elevated)]/50 text-[var(--color-text-secondary)]'
                    }`}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={() => onSelect(file.projectName, file.path, node.path)}
            >
                <span className={`font-mono text-[10px] font-bold ${STATUS_COLORS[file.status] || 'text-[var(--color-text-muted)]'}`}>
                    {file.status}
                </span>
                <span className="truncate">{node.name}</span>
            </button>
        );
    }

    if (!hasChildren) return null;

    return (
        <div>
            <button
                className="w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-[var(--color-bg-elevated)]/50 text-[var(--color-text-secondary)] transition-colors rounded-sm"
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={() => onToggleExpand(node.path)}
            >
                <ChevronIcon expanded={isExpanded} className="w-3 h-3 shrink-0" />
                <FolderIcon className="w-3.5 h-3.5 shrink-0 text-[var(--color-accent)]/60" />
                <span className="truncate font-medium">{node.name}</span>
                <span className="text-[10px] text-[var(--color-text-muted)] ml-auto shrink-0">
                    {countFiles(node)}
                </span>
            </button>
            {isExpanded && (
                <div>
                    {Array.from(node.children.values())
                        .sort((a, b) => {
                            // Directories first, then files
                            const aIsDir = !a.file;
                            const bIsDir = !b.file;
                            if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
                            return a.name.localeCompare(b.name);
                        })
                        .map((child) => (
                            <FileTreeItem
                                key={child.path}
                                node={child}
                                depth={depth + 1}
                                selectedFile={selectedFile}
                                onSelect={onSelect}
                                expandedPaths={expandedPaths}
                                onToggleExpand={onToggleExpand}
                            />
                        ))}
                </div>
            )}
        </div>
    );
};

function countFiles(node: TreeNode): number {
    if (node.file) return 1;
    let count = 0;
    for (const child of node.children.values()) {
        count += countFiles(child);
    }
    return count;
}

// ==================== Syntax Highlighting ====================

import hljs from 'highlight.js/lib/core';
import 'highlight.js/styles/vs2015.css';

// Register commonly used languages
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import java from 'highlight.js/lib/languages/java';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import sql from 'highlight.js/lib/languages/sql';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import csharp from 'highlight.js/lib/languages/csharp';
import shell from 'highlight.js/lib/languages/shell';
import yaml from 'highlight.js/lib/languages/yaml';
import properties from 'highlight.js/lib/languages/properties';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('java', java);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('python', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('properties', properties);
hljs.registerLanguage('markdown', markdown);

// File extension → hljs language mapping
function detectLanguage(filePath: string): string | undefined {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
        java: 'java', kt: 'java',
        rs: 'rust',
        py: 'python',
        go: 'go',
        cs: 'csharp',
        c: 'csharp', cpp: 'csharp', h: 'csharp',
        sql: 'sql',
        sh: 'shell', bash: 'shell', zsh: 'shell',
        xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml', jsp: 'xml', aspx: 'xml',
        css: 'css', scss: 'css', less: 'css',
        json: 'json',
        yaml: 'yaml', yml: 'yaml', toml: 'yaml',
        properties: 'properties', ini: 'properties', conf: 'properties', cfg: 'properties',
        md: 'markdown', mdx: 'markdown',
    };
    return map[ext];
}

// Highlight a single line using highlight.js — returns HTML string
function highlightLine(line: string, lang: string | undefined): React.ReactNode {
    if (!line || !lang) return line;
    try {
        const result = hljs.highlight(line, { language: lang, ignoreIllegals: true });
        return <span dangerouslySetInnerHTML={{ __html: result.value }} />;
    } catch {
        return line;
    }
}


// ==================== DiffView ====================

const DiffView: FC<{
    diff: FileDiff;
}> = ({ diff }) => {
    const { t } = useTranslation();
    const pairs = useMemo(
        () => computeSideBySideDiff(diff.old_content, diff.new_content),
        [diff.new_content, diff.old_content]
    );
    const lang = detectLanguage(diff.file_path);
    const [showChangedOnly, setShowChangedOnly] = useState(pairs.length > LARGE_DIFF_THRESHOLD);

    useEffect(() => {
        setShowChangedOnly(pairs.length > LARGE_DIFF_THRESHOLD);
    }, [diff.file_path, pairs.length]);

    const changedOnlyRows = useMemo(
        () => buildChangedOnlyRows(pairs, DIFF_CONTEXT_LINES),
        [pairs]
    );
    const canUseChangedOnly = changedOnlyRows.some((row) => row.type === 'gap');
    const useChangedOnlyMode = showChangedOnly && canUseChangedOnly;
    const renderedRows = useChangedOnlyMode
        ? changedOnlyRows
        : pairs.map((pair) => ({ type: 'pair', pair } as DiffRow));

    // Limit rendering to avoid lag
    const MAX_LINES = 2000;
    const truncated = !useChangedOnlyMode && pairs.length > MAX_LINES;
    const displayRows = truncated ? renderedRows.slice(0, MAX_LINES) : renderedRows;

    const renderLineCell = (line: DiffLine, side: 'left' | 'right') => {
        const isChange = side === 'left' ? line.type === 'remove' : line.type === 'add';
        const isEmpty = line.type === 'empty';
        const lineNumber = side === 'left' ? line.oldLine : line.newLine;
        const marker = side === 'left'
            ? line.type === 'remove' ? '−' : ' '
            : line.type === 'add' ? '+' : ' ';

        return (
            <div
                className={`flex min-h-[1.6em] ${isChange
                    ? side === 'left' ? 'bg-red-500/10' : 'bg-emerald-500/10'
                    : isEmpty ? 'bg-[var(--color-bg-elevated)]/10' : ''
                    }`}
            >
                <span className="w-10 shrink-0 text-right pr-2 text-[var(--color-text-muted)] select-none text-[11px]">
                    {lineNumber ?? ''}
                </span>
                <span className="w-4 shrink-0 text-center text-[var(--color-text-muted)] select-none">
                    {marker}
                </span>
                <pre className="flex-1 whitespace-pre-wrap break-all pr-2">
                    {highlightLine(line.content, lang)}
                </pre>
            </div>
        );
    };

    if (diff.is_binary) {
        return (
            <div className="border-b border-[var(--color-border)]/50">
                <div className="sticky top-0 z-10 bg-[var(--color-bg-surface)] border-b border-[var(--color-border)]/50 px-4 py-2 flex items-center gap-2">
                    <span className="text-xs font-mono text-[var(--color-text-secondary)]">{diff.file_path}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)] px-1.5 py-0.5 rounded bg-[var(--color-bg-elevated)]/50">Binary</span>
                </div>
                <div className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
                    Binary file — cannot display diff
                </div>
            </div>
        );
    }

    return (
        <div className="border-b border-[var(--color-border)]/50">
            {/* Sticky file header */}
            <div className="sticky top-0 z-10 bg-[var(--color-bg-surface)]/95 backdrop-blur-sm border-b border-[var(--color-border)]/50 px-4 py-2 flex items-center gap-2">
                <span className="text-xs font-mono text-[var(--color-text-secondary)]">{diff.file_path}</span>
                {diff.is_new && (
                    <span className="text-[10px] text-[var(--color-success)] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30">New</span>
                )}
                {diff.is_deleted && (
                    <span className="text-[10px] text-[var(--color-error)] px-1.5 py-0.5 rounded bg-[var(--color-error)]/10 border border-[var(--color-error)]/30">Deleted</span>
                )}
                {canUseChangedOnly && (
                    <div className="ml-auto flex items-center gap-1">
                        <Button
                            variant={showChangedOnly ? 'secondary' : 'ghost'}
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => setShowChangedOnly(true)}
                        >
                            {t('detail.showChangedBlocks', 'Changed blocks')}
                        </Button>
                        <Button
                            variant={!showChangedOnly ? 'secondary' : 'ghost'}
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => setShowChangedOnly(false)}
                        >
                            {t('detail.showFullDiff', 'Full file')}
                        </Button>
                    </div>
                )}
            </div>

            {/* Side-by-side diff */}
            <div className="text-[12px] font-mono leading-[1.6] overflow-x-auto">
                {displayRows.map((row, index) => {
                    if (row.type === 'gap') {
                        return (
                            <div key={`gap-${index}`} className="grid grid-cols-2">
                                <div className="col-span-2 px-4 py-1.5 text-center text-[11px] text-[var(--color-text-muted)] bg-[var(--color-bg-surface)]/70 border-y border-[var(--color-border)]/30">
                                    {t('detail.hiddenUnchangedLines', {
                                        count: row.hiddenCount,
                                        defaultValue: '{{count}} unchanged lines hidden',
                                    })}
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div key={`pair-${index}`} className="grid grid-cols-2">
                            <div className="border-r border-[var(--color-border)]/30">
                                {renderLineCell(row.pair.left, 'left')}
                            </div>
                            <div>
                                {renderLineCell(row.pair.right, 'right')}
                            </div>
                        </div>
                    );
                })}
            </div>

            {truncated && (
                <div className="px-4 py-2 text-center text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-surface)]">
                    ... {pairs.length - MAX_LINES} more lines not shown ...
                </div>
            )}
        </div>
    );
};


// ==================== ChangedFilesPanel ====================

interface ChangedFilesPanelProps {
    projects: ProjectStatus[];
    reviewKey: string;
    focusProject?: string | null;
}

export const ChangedFilesPanel: FC<ChangedFilesPanelProps> = ({
    projects,
    reviewKey,
    focusProject,
}) => {
    const { t } = useTranslation();
    const [allFiles, setAllFiles] = useState<ChangedFileEntry[]>([]);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [diffs, setDiffs] = useState<Map<string, FileDiff>>(new Map());
    const [loadingDiffs, setLoadingDiffs] = useState<Set<string>>(new Set());
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
    const [projectFilter, setProjectFilter] = useState<string | null>(focusProject ?? null);
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
    const [treeWidth, setTreeWidth] = useState(280);
    const resizingRef = useRef(false);
    const treeContainerRef = useRef<HTMLDivElement>(null);

    const totalChanges = projects.reduce(
        (sum, p) => sum + p.uncommitted_count,
        0
    );

    const projectNames = useMemo(
        () => projects.filter((project) => project.uncommitted_count > 0).map((project) => project.name),
        [projects]
    );

    // Load all changed files
    useEffect(() => {
        if (totalChanges === 0) return;

        let cancelled = false;
        setLoadingFiles(true);

        const load = async () => {
            const results: ChangedFileEntry[] = [];
            await Promise.all(
                projects.map(async (p) => {
                    if (p.uncommitted_count === 0) return;
                    try {
                        const files = await getChangedFiles(p.path);
                        if (!cancelled) {
                            for (const f of files) {
                                results.push({ ...f, projectName: p.name });
                            }
                        }
                    } catch (e) {
                        console.error(`Failed to get changed files for ${p.name}:`, e);
                    }
                })
            );

            if (!cancelled) {
                setAllFiles(results);
                setLoadingFiles(false);
                const rememberedSelection = readRememberedSelection(reviewKey);
                setSelectedFile((prev) => {
                    if (prev && results.some((file) => `${file.projectName}/${file.path}` === prev)) {
                        return prev;
                    }
                    if (
                        rememberedSelection &&
                        results.some((file) => `${file.projectName}/${file.path}` === rememberedSelection)
                    ) {
                        return rememberedSelection;
                    }
                    return null;
                });
                setDiffs((prev) => {
                    const next = new Map<string, FileDiff>();
                    for (const file of results) {
                        const key = `${file.projectName}/${file.path}`;
                        const cached = prev.get(key);
                        if (cached) {
                            next.set(key, cached);
                        }
                    }
                    return next;
                });
                setExpandedPaths(buildExpandedPathSet(results));
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [projects, reviewKey, totalChanges]);

    useEffect(() => {
        setProjectFilter(focusProject ?? null);
    }, [focusProject]);

    useEffect(() => {
        if (!selectedFile) return;
        writeRememberedSelection(reviewKey, selectedFile);
    }, [reviewKey, selectedFile]);

    const loadDiff = useCallback(
        async (projectName: string, filePath: string, key: string) => {
            if (diffs.has(key)) {
                setSelectedFile(key);
                return;
            }

            const project = projects.find((p) => p.name === projectName);
            if (!project) return;

            setLoadingDiffs((prev) => new Set(prev).add(key));
            setSelectedFile(key);

            try {
                const diff = await getFileDiff(project.path, filePath);
                setDiffs((prev) => new Map(prev).set(key, diff));
            } catch (e) {
                console.error('Failed to load diff:', e);
            } finally {
                setLoadingDiffs((prev) => {
                    const next = new Set(prev);
                    next.delete(key);
                    return next;
                });
            }
        },
        [diffs, projects]
    );

    const handleSelectFile = useCallback(
        (projectName: string, filePath: string, key: string) => {
            loadDiff(projectName, filePath, key);
        },
        [loadDiff]
    );

    const handleToggleStatusFilter = useCallback((status: string) => {
        setStatusFilters((prev) => {
            const next = new Set(prev);
            if (next.has(status)) {
                next.delete(status);
            } else {
                next.add(status);
            }
            return next;
        });
    }, []);

    const handleToggleExpand = useCallback((path: string) => {
        setExpandedPaths((prev) => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    }, []);

    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filesInScope = useMemo(() => {
        return allFiles.filter((file) => {
            if (projectFilter && file.projectName !== projectFilter) return false;
            if (!normalizedQuery) return true;
            const haystack = `${file.projectName}/${file.path}`.toLowerCase();
            return haystack.includes(normalizedQuery);
        });
    }, [allFiles, normalizedQuery, projectFilter]);

    const availableStatusCounts = useMemo(
        () => countStatuses(filesInScope),
        [filesInScope]
    );

    const visibleFiles = useMemo(() => {
        if (statusFilters.size === 0) return filesInScope;
        return filesInScope.filter((file) => statusFilters.has(file.status));
    }, [filesInScope, statusFilters]);

    const visibleStatusCounts = useMemo(
        () => countStatuses(visibleFiles),
        [visibleFiles]
    );

    const orderedVisibleFiles = useMemo(
        () => [...visibleFiles].sort((a, b) => {
            const byProject = a.projectName.localeCompare(b.projectName);
            if (byProject !== 0) return byProject;
            return a.path.localeCompare(b.path);
        }),
        [visibleFiles]
    );

    useEffect(() => {
        setSelectedFile((prev) => {
            if (!prev) return null;
            return visibleFiles.some((file) => `${file.projectName}/${file.path}` === prev)
                ? prev
                : null;
        });
    }, [visibleFiles]);

    const selectedFileMeta = useMemo(
        () => selectedFile
            ? visibleFiles.find((file) => `${file.projectName}/${file.path}` === selectedFile)
                ?? allFiles.find((file) => `${file.projectName}/${file.path}` === selectedFile)
                ?? null
            : null,
        [allFiles, selectedFile, visibleFiles]
    );
    const selectedDiff = selectedFile ? diffs.get(selectedFile) ?? null : null;
    const isSelectedDiffLoading = selectedFile ? loadingDiffs.has(selectedFile) : false;
    const selectedIndex = selectedFile
        ? orderedVisibleFiles.findIndex((file) => `${file.projectName}/${file.path}` === selectedFile)
        : -1;

    useEffect(() => {
        if (!selectedFileMeta || selectedDiff || isSelectedDiffLoading) return;
        const key = `${selectedFileMeta.projectName}/${selectedFileMeta.path}`;
        void loadDiff(selectedFileMeta.projectName, selectedFileMeta.path, key);
    }, [isSelectedDiffLoading, loadDiff, selectedDiff, selectedFileMeta]);

    const effectiveExpandedPaths = useMemo(() => {
        const next = new Set(expandedPaths);
        const shouldForceExpand = Boolean(projectFilter || normalizedQuery || statusFilters.size > 0);

        if (shouldForceExpand) {
            buildExpandedPathSet(visibleFiles).forEach((path) => next.add(path));
        }

        if (selectedFileMeta) {
            buildExpandedPathSet([selectedFileMeta]).forEach((path) => next.add(path));
        }

        return next;
    }, [expandedPaths, normalizedQuery, projectFilter, selectedFileMeta, statusFilters, visibleFiles]);

    useEffect(() => {
        if (!selectedFile || !treeContainerRef.current) return;
        const target = treeContainerRef.current.querySelector<HTMLElement>(
            `[data-file-key="${CSS.escape(selectedFile)}"]`
        );
        target?.scrollIntoView({ block: 'nearest' });
    }, [effectiveExpandedPaths, selectedFile]);

    const clearFilters = useCallback(() => {
        setSearchQuery('');
        setStatusFilters(new Set());
        setProjectFilter(null);
    }, []);

    const selectRelativeFile = useCallback((offset: -1 | 1) => {
        if (selectedIndex < 0) return;
        const target = orderedVisibleFiles[selectedIndex + offset];
        if (!target) return;
        const key = `${target.projectName}/${target.path}`;
        void loadDiff(target.projectName, target.path, key);
    }, [loadDiff, orderedVisibleFiles, selectedIndex]);

    useEffect(() => {
        if (selectedFile || orderedVisibleFiles.length === 0) return;
        if (!focusProject && orderedVisibleFiles.length !== 1) return;
        const target = orderedVisibleFiles[0];
        const key = `${target.projectName}/${target.path}`;
        void loadDiff(target.projectName, target.path, key);
    }, [focusProject, loadDiff, orderedVisibleFiles, selectedFile]);

    // Resize handler for tree panel
    const handleMouseDown = useCallback(() => {
        resizingRef.current = true;
        const handleMouseMove = (e: MouseEvent) => {
            if (!resizingRef.current) return;
            setTreeWidth((prev) => Math.max(200, Math.min(500, prev + e.movementX)));
        };
        const handleMouseUp = () => {
            resizingRef.current = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, []);

    const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);

    if (totalChanges === 0) return null;

    return (
        <div className="h-full flex flex-col">
            <div className="shrink-0 border-b border-[var(--color-border)]/50 bg-[var(--color-bg-surface)]/30">
                <div className="flex items-center gap-2 px-4 py-2">
                    <LogIcon className="w-4 h-4 text-[var(--color-text-secondary)]" />
                    <span className="text-sm font-medium text-[var(--color-text-secondary)]">
                        {t('detail.changedFiles', 'Changed Files')}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)]/50 px-2 py-0.5 rounded-full">
                        {totalChanges}
                    </span>
                    {visibleFiles.length !== allFiles.length && (
                        <span className="text-xs text-[var(--color-accent)] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 px-2 py-0.5 rounded-full">
                            {visibleFiles.length}/{allFiles.length}
                        </span>
                    )}
                </div>
                <div className="px-4 pb-3 space-y-2">
                    <div className="flex items-center gap-2">
                        <Input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder={t('detail.filterChangedFiles', 'Filter by project or file path')}
                            className="h-8 bg-[var(--color-bg-base)]/60 border-[var(--color-border)] text-sm"
                        />
                        {(searchQuery || statusFilters.size > 0 || projectFilter) && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 shrink-0 text-xs text-[var(--color-text-secondary)]"
                                onClick={clearFilters}
                            >
                                {t('common.clear', 'Clear')}
                            </Button>
                        )}
                    </div>

                    {projectNames.length > 1 && (
                        <div className="flex flex-wrap gap-1.5">
                            <button
                                className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                                    projectFilter === null
                                        ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                                        : 'border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                                }`}
                                onClick={() => setProjectFilter(null)}
                            >
                                {t('common.all', 'All')}
                            </button>
                            {projectNames.map((projectName) => {
                                const projectCount = allFiles.filter((file) => file.projectName === projectName).length;
                                return (
                                    <button
                                        key={projectName}
                                        className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                                            projectFilter === projectName
                                                ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                                                : 'border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                                        }`}
                                        onClick={() => setProjectFilter(projectName)}
                                    >
                                        {projectName} ({projectCount})
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                        {STATUS_ORDER.map((status) => {
                            const count = availableStatusCounts[status] || 0;
                            if (count === 0) return null;
                            const active = statusFilters.has(status);
                            return (
                                <button
                                    key={status}
                                    title={STATUS_LABELS[status]}
                                    className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                                        active
                                            ? `${STATUS_BG[status]} ${STATUS_COLORS[status]}`
                                            : 'border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                                    }`}
                                    onClick={() => handleToggleStatusFilter(status)}
                                >
                                    <span className="font-mono">{status}</span> {count}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 flex">
                {/* File tree sidebar */}
                <div
                    ref={treeContainerRef}
                    className="shrink-0 border-r border-[var(--color-border)]/50 overflow-y-auto bg-[var(--color-bg-surface)]/30"
                    style={{ width: `${treeWidth}px` }}
                >
                    {loadingFiles ? (
                        <div className="flex items-center justify-center py-8">
                            <RefreshIcon className="w-5 h-5 text-[var(--color-text-muted)] animate-spin" />
                        </div>
                    ) : visibleFiles.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-4 py-10 text-center text-[var(--color-text-muted)] gap-2">
                            <LogIcon className="w-8 h-8" />
                            <p className="text-sm">{t('detail.noChangedFilesMatch', 'No changed files match the current filters')}</p>
                        </div>
                    ) : (
                        <div className="py-1">
                            {/* Summary */}
                            <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] text-[var(--color-text-muted)] border-b border-[var(--color-border)]/30 mb-1">
                                {STATUS_ORDER.map((s) => {
                                    const count = visibleStatusCounts[s] || 0;
                                    if (count === 0) return null;
                                    return (
                                        <span
                                            key={s}
                                            className={`px-1.5 py-0.5 rounded border ${STATUS_BG[s] || 'bg-[var(--color-bg-elevated)]/30 border-[var(--color-border)]'}`}
                                        >
                                            <span className={STATUS_COLORS[s]}>{count}</span>{' '}
                                            <span className="text-[var(--color-text-muted)]">
                                                {STATUS_LABELS[s]}
                                            </span>
                                        </span>
                                    );
                                })}
                            </div>
                            {Array.from(tree.children.values())
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((child) => (
                                    <FileTreeItem
                                        key={child.path}
                                        node={child}
                                        depth={0}
                                        selectedFile={selectedFile}
                                        onSelect={handleSelectFile}
                                        expandedPaths={effectiveExpandedPaths}
                                        onToggleExpand={handleToggleExpand}
                                    />
                                ))}
                        </div>
                    )}
                </div>

                {/* Resize handle */}
                <div
                    className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-accent)]/30 active:bg-[var(--color-accent)]/50 transition-colors"
                    onMouseDown={handleMouseDown}
                />

                {/* Diff content */}
                <div className="flex-1 min-w-0 flex flex-col">
                    {selectedFileMeta && (
                        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)]/50 bg-[var(--color-bg-base)]/40">
                            <span className={`font-mono text-xs font-bold ${STATUS_COLORS[selectedFileMeta.status] || 'text-[var(--color-text-secondary)]'}`}>
                                {selectedFileMeta.status}
                            </span>
                            <span className="rounded bg-[var(--color-bg-elevated)]/60 px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                                {selectedFileMeta.projectName}
                            </span>
                            <span className="min-w-0 truncate text-xs text-[var(--color-text-secondary)]">
                                {selectedFileMeta.path}
                            </span>
                            <div className="ml-auto flex items-center gap-2">
                                <span className="text-[11px] text-[var(--color-text-muted)]">
                                    {selectedIndex >= 0 ? `${selectedIndex + 1}/${orderedVisibleFiles.length}` : null}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={selectedIndex <= 0}
                                    onClick={() => selectRelativeFile(-1)}
                                >
                                    {t('common.previous', 'Previous')}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={selectedIndex < 0 || selectedIndex >= orderedVisibleFiles.length - 1}
                                    onClick={() => selectRelativeFile(1)}
                                >
                                    {t('common.next', 'Next')}
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto">
                        {visibleFiles.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
                                <LogIcon className="w-10 h-10" />
                                <p className="text-sm">{t('detail.noChangedFilesMatch', 'No changed files match the current filters')}</p>
                            </div>
                        ) : !selectedFile ? (
                            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
                                <LogIcon className="w-10 h-10" />
                                <p className="text-sm">{t('detail.selectFileToDiff', 'Select a file to view diff')}</p>
                            </div>
                        ) : isSelectedDiffLoading ? (
                            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-3">
                                <RefreshIcon className="w-5 h-5 animate-spin" />
                                <p className="text-sm text-[var(--color-text-secondary)]">
                                    {selectedFileMeta?.path || t('common.loading')}
                                </p>
                            </div>
                        ) : selectedDiff ? (
                            <DiffView diff={selectedDiff} />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] gap-2">
                                <LogIcon className="w-10 h-10" />
                                <p className="text-sm">{t('detail.selectFileToDiff', 'Select a file to view diff')}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
