export interface CommitPrefixVars {
  worktreeName: string;
  projectName: string;
  branchName: string;
  repoName: string;
}

function formatDate(fmt: string): string {
  const now = new Date();
  const map: Record<string, string> = {
    'YYYY': String(now.getFullYear()),
    'MM': String(now.getMonth() + 1).padStart(2, '0'),
    'DD': String(now.getDate()).padStart(2, '0'),
    'HH': String(now.getHours()).padStart(2, '0'),
    'mm': String(now.getMinutes()).padStart(2, '0'),
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm/g, (m) => map[m] ?? m);
}

export function renderCommitPrefix(
  template: string,
  vars: CommitPrefixVars,
): string {
  return template
    .replace(/{{worktree-name}}/g, vars.worktreeName)
    .replace(/{{project-name}}/g, vars.projectName)
    .replace(/{{branch-name}}/g, vars.branchName)
    .replace(/{{repo-name}}/g, vars.repoName)
    .replace(/{{date(?::([^}]+))?}}/g, (_, fmt) => formatDate(fmt || 'YYYY-MM-DD'));
}
