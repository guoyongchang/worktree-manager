const STORAGE_KEY = 'wm-ui-restore';

export interface UiRestoreSnapshot {
  workspacePath: string;
  selectedWorktreeName: string | null;
  activatedTerminals: string[];
  activeTerminalTab: string | null;
  terminalVisible: boolean;
  terminalHeight: number;
}

const EMPTY_SNAPSHOT: UiRestoreSnapshot = {
  workspacePath: '',
  selectedWorktreeName: null,
  activatedTerminals: [],
  activeTerminalTab: null,
  terminalVisible: false,
  terminalHeight: 280,
};

function parseSnapshot(raw: string): UiRestoreSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Partial<UiRestoreSnapshot>;
    if (!parsed || typeof parsed.workspacePath !== 'string') return null;
    return {
      workspacePath: parsed.workspacePath,
      selectedWorktreeName: parsed.selectedWorktreeName ?? null,
      activatedTerminals: Array.isArray(parsed.activatedTerminals) ? parsed.activatedTerminals : [],
      activeTerminalTab: parsed.activeTerminalTab ?? null,
      terminalVisible: !!parsed.terminalVisible,
      terminalHeight: typeof parsed.terminalHeight === 'number' ? parsed.terminalHeight : 280,
    };
  } catch {
    return null;
  }
}

function readStoredSnapshot(): UiRestoreSnapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseSnapshot(raw);
  } catch {
    return null;
  }
}

let latest: UiRestoreSnapshot = readStoredSnapshot() ?? { ...EMPTY_SNAPSHOT };

export function updateUiRestoreSnapshot(patch: Partial<UiRestoreSnapshot>): void {
  latest = { ...latest, ...patch };
}

export function readUiRestoreSnapshot(): UiRestoreSnapshot | null {
  return readStoredSnapshot();
}

export function persistAndReload(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(latest));
  } catch {
    // still reload
  }
  window.location.reload();
}
