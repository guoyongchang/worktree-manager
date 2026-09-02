use git2::{Repository, StatusOptions};
use serde::Serialize;
use std::path::Path;

use crate::utils::{git_command, run_command_with_timeout, run_git_logged};

fn command_without_window(program: &str) -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut command = std::process::Command::new(program);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new(program)
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct WorktreeInfo {
    pub current_branch: String,
    pub uncommitted_count: usize,
    pub is_merged_to_test: bool,
    pub is_merged_to_base: bool,
    pub ahead_of_base: usize,
    pub behind_base: usize,
    pub ahead_of_test: usize,
    pub unpushed_commits: usize,
    pub remote_url: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct BranchStatus {
    pub project_name: String,
    pub branch_name: String,
    pub has_uncommitted: bool,
    pub uncommitted_count: usize,
    pub is_pushed: bool,
    pub unpushed_commits: usize,
    pub has_merge_request: bool,
    pub remote_url: String,
}

impl Default for WorktreeInfo {
    fn default() -> Self {
        Self {
            current_branch: "unknown".to_string(),
            uncommitted_count: 0,
            is_merged_to_test: false,
            is_merged_to_base: false,
            ahead_of_base: 0,
            behind_base: 0,
            ahead_of_test: 0,
            unpushed_commits: 0,
            remote_url: String::new(),
        }
    }
}

pub fn get_worktree_info(path: &Path) -> WorktreeInfo {
    get_worktree_info_for_branches(
        path,
        get_base_branch_for_path(path),
        get_test_branch_for_path(path),
    )
}

pub fn get_worktree_info_for_branches(
    path: &Path,
    base_branch: &str,
    test_branch: &str,
) -> WorktreeInfo {
    let repo = match Repository::open(path) {
        Ok(r) => r,
        Err(_) => return WorktreeInfo::default(),
    };

    let mut info = WorktreeInfo::default();

    // Get current branch
    if let Ok(head) = repo.head() {
        if let Some(name) = head.shorthand() {
            info.current_branch = name.to_string();
        }
    }

    // Get remote URL
    if let Ok(remote) = repo.find_remote("origin") {
        if let Some(url) = remote.url() {
            info.remote_url = url.to_string();
        }
    }

    // Get uncommitted changes count
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(false);

    if let Ok(statuses) = repo.statuses(Some(&mut opts)) {
        info.uncommitted_count = statuses.len();
    }

    // Check if merged to test branch
    // This is a simplified check - just see if test branch ref exists and compare
    if let Ok(test_ref) = repo.find_reference(&format!("refs/remotes/origin/{}", test_branch)) {
        if let Ok(head) = repo.head() {
            if let (Ok(test_commit), Ok(head_commit)) =
                (test_ref.peel_to_commit(), head.peel_to_commit())
            {
                // Check if head commit is ancestor of test branch
                if let Ok(is_ancestor) =
                    repo.graph_descendant_of(test_commit.id(), head_commit.id())
                {
                    info.is_merged_to_test = is_ancestor;
                }
            }
            // Get ahead count relative to test branch
            if let (Some(head_oid), Some(test_oid)) = (head.target(), test_ref.target()) {
                if let Ok((ahead, _)) = repo.graph_ahead_behind(head_oid, test_oid) {
                    info.ahead_of_test = ahead;
                }
            }
        }
    }

    // Get ahead/behind count relative to base branch
    if let Ok(base_ref) = repo.find_reference(&format!("refs/remotes/origin/{}", base_branch)) {
        if let Ok(head) = repo.head() {
            if let (Ok(base_oid), Ok(head_oid)) =
                (base_ref.target().ok_or(()), head.target().ok_or(()))
            {
                if let Ok((ahead, behind)) = repo.graph_ahead_behind(head_oid, base_oid) {
                    info.ahead_of_base = ahead;
                    info.behind_base = behind;
                }
                // Check if merged to base (base contains HEAD)
                if let Ok(is_ancestor) = repo.graph_descendant_of(base_oid, head_oid) {
                    info.is_merged_to_base = is_ancestor;
                }
            }
        }
    }

    // Get unpushed commits (ahead of origin/<current_branch>)
    let remote_branch = format!("refs/remotes/origin/{}", info.current_branch);
    if let Ok(remote_ref) = repo.find_reference(&remote_branch) {
        if let Ok(head) = repo.head() {
            if let (Some(head_oid), Some(remote_oid)) = (head.target(), remote_ref.target()) {
                if let Ok((ahead, _)) = repo.graph_ahead_behind(head_oid, remote_oid) {
                    info.unpushed_commits = ahead;
                }
            }
        }
    } else {
        // Remote branch doesn't exist — all local commits are unpushed
        if let Ok(base_ref) = repo.find_reference(&format!("refs/remotes/origin/{}", base_branch)) {
            if let Ok(head) = repo.head() {
                if let (Some(head_oid), Some(base_oid)) = (head.target(), base_ref.target()) {
                    if let Ok((ahead, _)) = repo.graph_ahead_behind(head_oid, base_oid) {
                        info.unpushed_commits = ahead;
                    }
                }
            }
        }
    }

    info
}

fn get_base_branch_for_path(_path: &Path) -> &str {
    "uat"
}

fn get_test_branch_for_path(_path: &Path) -> &str {
    "test"
}

pub fn get_branch_status(path: &Path, project_name: &str, base_branch: &str) -> BranchStatus {
    let mut status = BranchStatus {
        project_name: project_name.to_string(),
        branch_name: "unknown".to_string(),
        has_uncommitted: false,
        uncommitted_count: 0,
        is_pushed: false,
        unpushed_commits: 0,
        has_merge_request: false,
        remote_url: String::new(),
    };

    let repo = match Repository::open(path) {
        Ok(r) => r,
        Err(_) => return status,
    };

    // Get current branch name
    if let Ok(head) = repo.head() {
        if let Some(name) = head.shorthand() {
            status.branch_name = name.to_string();
        }
    }

    // Get uncommitted changes
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(false);
    if let Ok(statuses) = repo.statuses(Some(&mut opts)) {
        status.uncommitted_count = statuses.len();
        status.has_uncommitted = status.uncommitted_count > 0;
    }

    // Get remote URL
    if let Ok(remote) = repo.find_remote("origin") {
        if let Some(url) = remote.url() {
            status.remote_url = url.to_string();
        }
    }

    // Check if branch is pushed to remote (compare with origin/branch)
    let remote_branch = format!("refs/remotes/origin/{}", status.branch_name);
    if let Ok(head) = repo.head() {
        if let Some(head_oid) = head.target() {
            if let Ok(remote_ref) = repo.find_reference(&remote_branch) {
                if let Some(remote_oid) = remote_ref.target() {
                    // Branch exists on remote, check how many commits ahead
                    if let Ok((ahead, _)) = repo.graph_ahead_behind(head_oid, remote_oid) {
                        status.unpushed_commits = ahead;
                        status.is_pushed = ahead == 0;
                    }
                }
            } else {
                // Remote branch doesn't exist, not pushed
                status.is_pushed = false;
                // Count commits from merge-base with origin/uat or origin/master
                let base_ref = format!("refs/remotes/origin/{}", base_branch);
                if let Ok(base_ref) = repo.find_reference(&base_ref) {
                    if let Some(base_oid) = base_ref.target() {
                        if let Ok((ahead, _)) = repo.graph_ahead_behind(head_oid, base_oid) {
                            status.unpushed_commits = ahead;
                        }
                    }
                }
            }
        }
    }

    // Check for merge request by looking at remote refs
    // GitLab creates refs/merge-requests/X/head for open MRs
    // GitHub creates refs/pull/X/head
    // We check if there's a remote ref pointing to our branch
    let branch_name = &status.branch_name;

    // Try to detect MR by checking if the branch has been merged or has remote tracking
    // A more reliable way: check if remote branch exists with specific patterns
    if let Ok(refs) = repo.references() {
        for reference in refs.flatten() {
            if let Some(name) = reference.name() {
                // Check for GitLab merge request refs or GitHub pull refs
                if name.contains("merge-requests") || name.contains("pull") {
                    if let Ok(ref_commit) = reference.peel_to_commit() {
                        if let Ok(head) = repo.head() {
                            if let Ok(head_commit) = head.peel_to_commit() {
                                if ref_commit.id() == head_commit.id() {
                                    status.has_merge_request = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Alternative: if branch is pushed and remote branch exists, assume MR might exist
    // (This is a heuristic since we can't query GitLab/GitHub API directly without auth)
    if status.is_pushed
        && !status.branch_name.starts_with("uat")
        && !status.branch_name.starts_with("master")
        && !status.branch_name.starts_with("test")
        && !status.branch_name.starts_with("staging")
    {
        // Check if the remote branch exists
        let remote_branch = format!("refs/remotes/origin/{}", branch_name);
        if repo.find_reference(&remote_branch).is_ok() {
            // Branch is pushed to remote - we mark has_merge_request as "unknown"
            // by keeping it false, user should verify manually
        }
    }

    status
}

#[derive(Debug, Serialize, Clone)]
pub struct BranchDiffStats {
    pub ahead: usize,
    pub behind: usize,
    pub changed_files: usize,
    pub unpushed_commits: usize,
    pub ahead_of_test: usize,
}

/// Sync with base branch (pull from base branch)
pub fn sync_with_base_branch(path: &Path, base_branch: &str) -> Result<String, String> {
    log::info!(
        "[git] Syncing with base branch: path={}, base_branch={}",
        path.display(),
        base_branch
    );

    // Step 1: Fetch from remote
    log::info!("[git] Step 1/2: git fetch origin {}", base_branch);
    let mut fetch_cmd = git_command();
    fetch_cmd
        .arg("-C")
        .arg(path)
        .arg("fetch")
        .arg("origin")
        .arg(base_branch);
    let fetch_output = run_git_logged(&mut fetch_cmd, "sync fetch base branch")
        .map_err(|e| format!("Failed to execute git fetch: {}", e))?;

    if !fetch_output.status.success() {
        let stderr = String::from_utf8_lossy(&fetch_output.stderr);
        log::error!(
            "[git] Step 1/2 FAILED: git fetch origin {}: {}",
            base_branch,
            stderr
        );
        return Err(format!("Git fetch failed: {}", stderr));
    }
    log::info!("[git] Step 1/2: git fetch succeeded");

    // Step 2: Merge origin/base_branch into current branch
    log::info!("[git] Step 2/2: git merge --no-edit origin/{}", base_branch);
    let mut merge_cmd = git_command();
    merge_cmd
        .arg("-C")
        .arg(path)
        .arg("merge")
        .arg("--no-edit")
        .arg(format!("origin/{}", base_branch));
    let merge_output = run_git_logged(&mut merge_cmd, "sync merge base branch")
        .map_err(|e| format!("Failed to execute git merge: {}", e))?;

    if !merge_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_output.stderr);
        log::error!(
            "[git] Step 2/2 FAILED: git merge origin/{}: {}",
            base_branch,
            stderr
        );
        return Err(format!("Git merge failed: {}", stderr));
    }

    log::info!(
        "[git] Successfully synced with base branch '{}'",
        base_branch
    );
    Ok(format!("Successfully synced with {}", base_branch))
}

/// Push current branch to remote
pub fn push_to_remote(path: &Path) -> Result<String, String> {
    log::info!("[git] Pushing to remote: path={}", path.display());

    // Step 1: Get current branch
    let branch_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()
        .map_err(|e| format!("Failed to get current branch: {}", e))?;

    if !branch_output.status.success() {
        log::error!("[git] Failed to get current branch at {}", path.display());
        return Err("Failed to get current branch".to_string());
    }

    let current_branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    log::info!("[git] Pushing branch '{}' to origin", current_branch);
    let mut push_cmd = git_command();
    push_cmd
        .arg("-C")
        .arg(path)
        .arg("push")
        .arg("-u")
        .arg("origin")
        .arg(&current_branch)
        .arg("--no-verify");
    let push_output = run_git_logged(&mut push_cmd, "push current branch")
        .map_err(|e| format!("Failed to execute git push: {}", e))?;

    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        log::error!(
            "[git] Push failed for branch '{}': {}",
            current_branch,
            stderr
        );
        return Err(format!("Git push failed: {}", stderr));
    }

    log::info!("[git] Successfully pushed '{}' to origin", current_branch);
    Ok(format!("Successfully pushed {} to origin", current_branch))
}

/// Pull current branch from remote (`git pull --no-rebase --ff --no-edit origin <current_branch>`).
///
/// The merge strategy is spelled out explicitly: Git >= 2.33.1 refuses a plain `git pull` on a
/// diverged branch ("Need to specify how to reconcile divergent branches") unless
/// `pull.rebase` is configured, and `--ff` keeps the historical "fast-forward when possible,
/// merge commit otherwise" behaviour even when `pull.ff=only` is set globally.
pub fn pull_current_branch(path: &Path) -> Result<String, String> {
    log::info!("[git] Pulling current branch: path={}", path.display());

    // Step 1: Get current branch
    let branch_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()
        .map_err(|e| format!("Failed to get current branch: {}", e))?;

    if !branch_output.status.success() {
        log::error!("[git] Failed to get current branch at {}", path.display());
        return Err("Failed to get current branch".to_string());
    }

    let current_branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    // Step 2: Pull from origin (explicit merge strategy, see fn docs)
    log::info!("[git] Pulling branch '{}' from origin", current_branch);
    let mut pull_cmd = git_command();
    pull_cmd
        .arg("-C")
        .arg(path)
        .arg("pull")
        .arg("--no-rebase")
        .arg("--ff")
        .arg("--no-edit")
        .arg("origin")
        .arg(&current_branch);
    let pull_output = run_git_logged(&mut pull_cmd, "pull current branch")
        .map_err(|e| format!("Failed to execute git pull: {}", e))?;

    if !pull_output.status.success() {
        let stderr = String::from_utf8_lossy(&pull_output.stderr);
        log::error!(
            "[git] Pull failed for branch '{}': {}",
            current_branch,
            stderr
        );
        if stderr.contains("couldn't find remote ref") {
            return Err(format!(
                "远程 origin 不存在分支 {}，无法拉取",
                current_branch
            ));
        }
        return Err(format!("Git pull failed: {}", stderr));
    }

    log::info!("[git] Successfully pulled '{}' from origin", current_branch);
    Ok(format!(
        "Successfully pulled {} from origin",
        current_branch
    ))
}

/// Run `git -C <path> <args>` through the shared logged runner.
/// Only spawn failures are mapped to `Err`; callers inspect `status` themselves.
fn run_git_in(path: &Path, args: &[&str], label: &str) -> Result<std::process::Output, String> {
    let mut cmd = git_command();
    cmd.arg("-C").arg(path).args(args);
    run_git_logged(&mut cmd, label).map_err(|e| format!("执行 git {} 失败: {}", args.join(" "), e))
}

/// Timeout for `git fetch` inside the merge flow (network).
const MERGE_FETCH_TIMEOUT_SECS: u64 = 180;
/// Timeout for `git push` inside the merge flow (network; large pushes take a while).
const MERGE_PUSH_TIMEOUT_SECS: u64 = 300;

/// Like `run_git_in` but bounded: network steps must never leave the merge button spinning.
/// A timeout is reported as `Err`, which the caller treats like any other failed step.
fn run_git_in_with_timeout(
    path: &Path,
    args: &[&str],
    label: &str,
    timeout_secs: u64,
) -> Result<std::process::Output, String> {
    let mut cmd = git_command();
    cmd.arg("-C").arg(path).args(args);
    run_command_with_timeout(
        &mut cmd,
        label,
        std::time::Duration::from_secs(timeout_secs),
    )
}

fn output_stderr(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).trim().to_string()
}

/// `git push` was rejected because the remote ref moved between our fetch and our push
/// (someone else pushed in between). These are worth exactly one fetch/merge/push retry;
/// anything else (auth, network, hooks, `[remote rejected]`) is not.
fn is_push_rejected_non_fast_forward(stderr: &str) -> bool {
    const MARKERS: [&str; 4] = [
        "[rejected]",
        "non-fast-forward",
        "fetch first",
        "stale info",
    ];
    MARKERS.iter().any(|marker| stderr.contains(marker))
}

/// Parse `git worktree list --porcelain` into `(worktree path, checked-out full branch ref)`.
/// Detached / bare worktrees have `None` as branch; prunable entries (directory gone) are skipped.
fn parse_worktree_list_porcelain(output: &str) -> Vec<(std::path::PathBuf, Option<String>)> {
    let mut worktrees = Vec::new();
    let mut path: Option<std::path::PathBuf> = None;
    let mut branch: Option<String> = None;
    let mut prunable = false;

    let mut flush = |path: &mut Option<std::path::PathBuf>,
                     branch: &mut Option<String>,
                     prunable: &mut bool| {
        if let Some(path) = path.take() {
            if !*prunable {
                worktrees.push((path, branch.take()));
            }
        }
        *branch = None;
        *prunable = false;
    };

    for line in output.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            flush(&mut path, &mut branch, &mut prunable);
        } else if let Some(wt_path) = line.strip_prefix("worktree ") {
            flush(&mut path, &mut branch, &mut prunable);
            path = Some(std::path::PathBuf::from(wt_path));
        } else if let Some(wt_branch) = line.strip_prefix("branch ") {
            branch = Some(wt_branch.to_string());
        } else if line == "prunable" || line.starts_with("prunable ") {
            prunable = true;
        }
    }
    flush(&mut path, &mut branch, &mut prunable);
    worktrees
}

/// Read the current branch via git2; detached HEAD is an error because there is nothing to merge.
fn current_branch_for_merge(path: &Path) -> Result<String, String> {
    let repo =
        Repository::open(path).map_err(|e| format!("无法打开仓库 ({}): {}", path.display(), e))?;
    let head = repo
        .head()
        .map_err(|e| format!("无法读取 HEAD ({}): {}", path.display(), e))?;
    if !head.is_branch() {
        return Err("无法获取当前分支名 (HEAD 可能处于 detached 状态)".to_string());
    }
    head.shorthand()
        .map(|name| name.to_string())
        .ok_or_else(|| "无法获取当前分支名 (HEAD 可能处于 detached 状态)".to_string())
}

/// `true` when `git status --porcelain --untracked-files=no` is empty (untracked files are fine).
fn has_clean_tracked_tree(path: &Path, label: &str) -> Result<bool, String> {
    let status = run_git_in(
        path,
        &["status", "--porcelain", "--untracked-files=no"],
        &format!("{} status", label),
    )?;
    if !status.status.success() {
        return Err(format!("检查工作区状态失败: {}", output_stderr(&status)));
    }
    Ok(String::from_utf8_lossy(&status.stdout).trim().is_empty())
}

/// fetch origin/<target> → detach onto it → merge <current_branch> → push HEAD:<target>.
/// Retries the whole sequence once when the push is rejected as non-fast-forward.
/// Leaves the worktree detached (on success) or wherever it stopped (on failure);
/// the caller always restores `current_branch` afterwards.
fn fetch_merge_push_remote_target(
    path: &Path,
    current_branch: &str,
    target: &str,
    label: &str,
) -> Result<(), String> {
    let remote_ref = format!("refs/remotes/origin/{}", target);
    let fetch_refspec = format!("+refs/heads/{}:{}", target, remote_ref);
    let push_refspec = format!("HEAD:refs/heads/{}", target);
    let merge_message = format!("Merge branch '{}' into {}", current_branch, target);
    // Fully qualified: a plain `git merge <name>` resolves a same-named TAG before the branch
    // (refs/tags/ wins over refs/heads/ in rev DWIM) and would silently merge the wrong thing.
    let feature_ref = format!("refs/heads/{}", current_branch);

    for attempt in 1..=2 {
        // Step 2: bring origin/<target> up to date (explicit refspec: works even for
        // single-branch clones and force-reset remote branches).
        log::info!(
            "[{}] Step 2: git fetch origin {} (attempt {}/2)",
            label,
            target,
            attempt
        );
        let fetch = run_git_in_with_timeout(
            path,
            &["fetch", "origin", &fetch_refspec],
            &format!("{} fetch target", label),
            MERGE_FETCH_TIMEOUT_SECS,
        )?;
        if !fetch.status.success() {
            let stderr = output_stderr(&fetch);
            log::error!("[{}] Step 2 FAILED: fetch => {}", label, stderr);
            if stderr.contains("couldn't find remote ref") {
                return Err(format!("远程分支 origin/{} 不存在", target));
            }
            return Err(format!("拉取 {} 最新代码失败: {}", target, stderr));
        }
        let verify = run_git_in(
            path,
            &["rev-parse", "--verify", "--quiet", &remote_ref],
            &format!("{} verify remote ref", label),
        )?;
        if !verify.status.success() {
            log::error!("[{}] Step 2 FAILED: {} does not exist", label, remote_ref);
            return Err(format!("远程分支 origin/{} 不存在", target));
        }
        log::info!("[{}] Step 2 OK: origin/{} is up to date", label, target);

        // Step 3: detached HEAD on the fresh remote tip. No local branch is checked out,
        // so this never conflicts with the main worktree or any other linked worktree.
        log::info!("[{}] Step 3: git checkout --detach {}", label, remote_ref);
        let checkout = run_git_in(
            path,
            &["checkout", "--detach", &remote_ref],
            &format!("{} checkout detach target", label),
        )?;
        if !checkout.status.success() {
            let stderr = output_stderr(&checkout);
            log::error!("[{}] Step 3 FAILED: checkout => {}", label, stderr);
            return Err(format!("切换到 {} 分支失败: {}", target, stderr));
        }
        log::info!("[{}] Step 3 OK: detached at origin/{}", label, target);

        // Step 4: merge (default fast-forward semantics).
        log::info!("[{}] Step 4: git merge {}", label, current_branch);
        let merge = run_git_in(
            path,
            // --ff: keep "fast-forward when possible" even if the user set merge.ff=only.
            &[
                "merge",
                "--ff",
                "--no-edit",
                "-m",
                &merge_message,
                &feature_ref,
            ],
            &format!("{} merge current", label),
        )?;
        if !merge.status.success() {
            let stderr = output_stderr(&merge);
            let stdout = String::from_utf8_lossy(&merge.stdout).trim().to_string();
            log::error!(
                "[{}] Step 4 FAILED: merge => stderr={}, stdout={}",
                label,
                stderr,
                stdout
            );
            let _ = run_git_in(
                path,
                &["merge", "--abort"],
                &format!("{} merge abort", label),
            );
            return Err(format!(
                "合并 {} 到 {} 失败: {}{}",
                current_branch,
                target,
                stderr,
                if stdout.is_empty() {
                    String::new()
                } else {
                    format!("\n{}", stdout)
                }
            ));
        }
        log::info!(
            "[{}] Step 4 OK: merged {} into origin/{}",
            label,
            current_branch,
            target
        );

        // Step 5: push the detached HEAD straight to the remote branch.
        log::info!("[{}] Step 5: git push origin {}", label, push_refspec);
        let push = run_git_in_with_timeout(
            path,
            &["push", "origin", &push_refspec, "--no-verify"],
            &format!("{} push target", label),
            MERGE_PUSH_TIMEOUT_SECS,
        )?;
        if push.status.success() {
            log::info!("[{}] Step 5 OK: pushed {}", label, target);
            return Ok(());
        }
        let stderr = output_stderr(&push);
        if attempt == 1 && is_push_rejected_non_fast_forward(&stderr) {
            log::warn!(
                "[{}] Step 5: push rejected (remote {} moved since fetch), retrying once: {}",
                label,
                target,
                stderr
            );
            continue;
        }
        log::error!("[{}] Step 5 FAILED: push => {}", label, stderr);
        return Err(format!("推送 {} 到远程失败: {}", target, stderr));
    }

    Err(format!("推送 {} 到远程失败: 重试后仍被远程拒绝", target))
}

/// Best-effort: bring the *local* `<target>` branch in line with what we just pushed.
/// Never fails the merge; returns human-readable notes for the result message.
fn sync_local_target_branch(path: &Path, target: &str, label: &str) -> Vec<String> {
    let mut notes = Vec::new();
    let target_ref = format!("refs/heads/{}", target);
    let remote_ref = format!("refs/remotes/origin/{}", target);

    let worktrees = match run_git_in(
        path,
        &["worktree", "list", "--porcelain"],
        &format!("{} worktree list", label),
    ) {
        Ok(output) if output.status.success() => {
            parse_worktree_list_porcelain(&String::from_utf8_lossy(&output.stdout))
        }
        Ok(output) => {
            log::warn!(
                "[{}] Step 6: git worktree list failed, skipping local {} sync: {}",
                label,
                target,
                output_stderr(&output)
            );
            return notes;
        }
        Err(e) => {
            log::warn!(
                "[{}] Step 6: git worktree list failed, skipping local {} sync: {}",
                label,
                target,
                e
            );
            return notes;
        }
    };

    let holders: Vec<&std::path::PathBuf> = worktrees
        .iter()
        .filter(|(_, branch)| branch.as_deref() == Some(target_ref.as_str()))
        .map(|(wt_path, _)| wt_path)
        .collect();

    if holders.is_empty() {
        let exists = run_git_in(
            path,
            &["rev-parse", "--verify", "--quiet", &target_ref],
            &format!("{} verify local target", label),
        )
        .map(|output| output.status.success())
        .unwrap_or(false);
        if !exists {
            log::info!(
                "[{}] Step 6: no local {} branch, nothing to sync",
                label,
                target
            );
            return notes;
        }

        let is_ancestor = run_git_in(
            path,
            &["merge-base", "--is-ancestor", &target_ref, &remote_ref],
            &format!("{} local target is-ancestor", label),
        )
        .map(|output| output.status.success())
        .unwrap_or(false);
        if !is_ancestor {
            log::warn!(
                "[{}] Step 6: local {} has commits not on origin/{}, leaving it untouched",
                label,
                target,
                target
            );
            notes.push(format!("⚠ 本地 {} 含有未推送的提交，已保留未动", target));
            return notes;
        }

        match run_git_in(
            path,
            &["branch", "-f", target, &remote_ref],
            &format!("{} force-update local target", label),
        ) {
            Ok(output) if output.status.success() => {
                log::info!(
                    "[{}] Step 6 OK: local {} moved to origin/{}",
                    label,
                    target,
                    target
                );
                notes.push(format!("✓ 本地 {} 分支已同步到 origin/{}", target, target));
            }
            Ok(output) => {
                log::warn!(
                    "[{}] Step 6: git branch -f {} failed: {}",
                    label,
                    target,
                    output_stderr(&output)
                );
                notes.push(format!(
                    "⚠ 本地 {} 分支未能同步到 origin/{}（{}），请手动处理",
                    target,
                    target,
                    output_stderr(&output)
                ));
            }
            Err(e) => {
                log::warn!("[{}] Step 6: git branch -f {} failed: {}", label, target, e);
                notes.push(format!(
                    "⚠ 本地 {} 分支未能同步到 origin/{}（{}），请手动处理",
                    target, target, e
                ));
            }
        }
        return notes;
    }

    for wt_path in holders {
        let ff_label = format!("{} fast-forward worktree target", label);
        let clean =
            wt_path.exists() && matches!(has_clean_tracked_tree(wt_path, &ff_label), Ok(true));
        let fast_forwarded = clean
            && run_git_in(wt_path, &["merge", "--ff-only", &remote_ref], &ff_label)
                .map(|output| output.status.success())
                .unwrap_or(false);
        if fast_forwarded {
            log::info!(
                "[{}] Step 6 OK: {} on {} fast-forwarded to origin/{}",
                label,
                target,
                wt_path.display(),
                target
            );
            notes.push(format!(
                "✓ {} 上的 {} 已快进到最新",
                wt_path.display(),
                target
            ));
        } else {
            log::warn!(
                "[{}] Step 6: {} on {} not updated (dirty or not fast-forwardable)",
                label,
                target,
                wt_path.display()
            );
            notes.push(format!(
                "⚠ {}: 本地 {} 未更新（有未提交更改或无法快进），请手动处理",
                wt_path.display(),
                target
            ));
        }
    }
    notes
}

/// `git checkout <branch> --`; returns a warning suffix for the user message when it fails.
fn restore_original_branch(path: &Path, branch: &str, label: &str) -> Option<String> {
    log::info!("[{}] Step 7: git checkout {}", label, branch);
    let failure = match run_git_in(
        path,
        &["checkout", branch, "--"],
        &format!("{} restore original branch", label),
    ) {
        Ok(output) if output.status.success() => {
            log::info!("[{}] Step 7 OK: back on {}", label, branch);
            return None;
        }
        Ok(output) => output_stderr(&output),
        Err(e) => e,
    };
    log::error!(
        "[{}] Step 7 FAILED: could not restore {}: {}",
        label,
        branch,
        failure
    );
    Some(format!(
        "\n⚠ 切回 {} 失败: {}，请手动执行 git checkout {}",
        branch, failure, branch
    ))
}

/// Merge the worktree's current branch into `origin/<target>` and push it back.
///
/// The local `<target>` branch is deliberately never checked out: we fetch the remote tip,
/// detach onto it, merge, and push `HEAD:refs/heads/<target>`. That way a stale or diverged
/// local `<target>`, or `<target>` being checked out in the main / another linked worktree,
/// can neither block the merge nor leak junk merge commits into the remote. Afterwards the
/// local `<target>` (wherever it lives) is fast-forwarded on a best-effort basis.
fn merge_current_branch_into_remote_target(
    path: &Path,
    target: &str,
    label: &str,
) -> Result<String, String> {
    log::info!("[{}] ===== START merge into {} =====", label, target);
    log::info!("[{}] path={}, target={}", label, path.display(), target);

    let current_branch = current_branch_for_merge(path)?;
    log::info!("[{}] current_branch={}", label, current_branch);

    // Step 1: refuse to shuffle HEAD around on top of uncommitted tracked changes.
    log::info!(
        "[{}] Step 1: checking for uncommitted tracked changes",
        label
    );
    if !has_clean_tracked_tree(path, label)? {
        log::warn!(
            "[{}] Step 1 FAILED: uncommitted tracked changes on {}",
            label,
            current_branch
        );
        return Err(format!(
            "当前分支有未提交的更改，请先提交或 git stash 贮藏后再合并到 {}",
            target
        ));
    }
    log::info!("[{}] Step 1 OK: tracked working tree is clean", label);

    // Steps 2-5
    let pipeline = fetch_merge_push_remote_target(path, &current_branch, target, label);

    // Step 6 (only after a successful push)
    let notes = if pipeline.is_ok() {
        log::info!("[{}] Step 6: syncing local {} branch", label, target);
        sync_local_target_branch(path, target, label)
    } else {
        Vec::new()
    };

    // Step 7: always go back to the feature branch.
    let restore_warning = restore_original_branch(path, &current_branch, label);

    match pipeline {
        Ok(()) => {
            let mut message = format!("成功将 {} 合并到 {}", current_branch, target);
            if !notes.is_empty() {
                message.push_str("\n\n");
                message.push_str(&notes.join("\n"));
            }
            if let Some(warning) = restore_warning {
                message.push_str(&warning);
            }
            log::info!("[{}] ===== DONE merge into {} =====", label, target);
            Ok(message)
        }
        Err(mut error) => {
            if let Some(warning) = restore_warning {
                error.push_str(&warning);
            }
            log::error!("[{}] ===== FAILED merge into {} =====", label, target);
            Err(error)
        }
    }
}

/// Merge current branch to test branch
pub fn merge_to_test_branch(path: &Path, test_branch: &str) -> Result<String, String> {
    merge_current_branch_into_remote_target(path, test_branch, "merge-test")
}

/// Merge current branch to base branch
pub fn merge_to_base_branch(path: &Path, base_branch: &str) -> Result<String, String> {
    merge_current_branch_into_remote_target(path, base_branch, "merge-base")
}

/// Get branch diff statistics
pub fn get_branch_diff_stats(
    path: &Path,
    base_branch: &str,
    test_branch: Option<&str>,
) -> BranchDiffStats {
    // Normalize empty string to None
    let test_branch = test_branch.filter(|s| !s.is_empty());
    log::info!(
        "[diff-stats] path={}, base_branch={}, test_branch={:?}",
        path.display(),
        base_branch,
        test_branch
    );
    let repo = match Repository::open(path) {
        Ok(r) => r,
        Err(_) => {
            return BranchDiffStats {
                ahead: 0,
                behind: 0,
                changed_files: 0,
                unpushed_commits: 0,
                ahead_of_test: 0,
            }
        }
    };

    let mut stats = BranchDiffStats {
        ahead: 0,
        behind: 0,
        changed_files: 0,
        unpushed_commits: 0,
        ahead_of_test: 0,
    };

    // Get ahead/behind count relative to base branch
    if let Ok(base_ref) = repo.find_reference(&format!("refs/remotes/origin/{}", base_branch)) {
        if let Ok(head) = repo.head() {
            if let (Ok(base_oid), Ok(head_oid)) =
                (base_ref.target().ok_or(()), head.target().ok_or(()))
            {
                if let Ok((ahead, behind)) = repo.graph_ahead_behind(head_oid, base_oid) {
                    stats.ahead = ahead;
                    stats.behind = behind;
                }
            }
        }
    }

    // Get unpushed commits (HEAD vs origin/<current_branch>)
    if let Ok(head) = repo.head() {
        if let Some(current_branch) = head.shorthand() {
            let remote_ref_name = format!("refs/remotes/origin/{}", current_branch);
            if let Ok(remote_ref) = repo.find_reference(&remote_ref_name) {
                if let (Some(head_oid), Some(remote_oid)) = (head.target(), remote_ref.target()) {
                    if let Ok((ahead, _)) = repo.graph_ahead_behind(head_oid, remote_oid) {
                        stats.unpushed_commits = ahead;
                    }
                }
            } else {
                // Remote branch doesn't exist — all commits ahead of base are unpushed
                stats.unpushed_commits = stats.ahead;
            }
        }
    }

    // Get ahead count relative to test branch
    if let Some(test) = test_branch {
        let test_ref_name = format!("refs/remotes/origin/{}", test);
        match repo.find_reference(&test_ref_name) {
            Ok(test_ref) => {
                if let Ok(head) = repo.head() {
                    if let (Some(head_oid), Some(test_oid)) = (head.target(), test_ref.target()) {
                        if let Ok((ahead, _)) = repo.graph_ahead_behind(head_oid, test_oid) {
                            stats.ahead_of_test = ahead;
                            log::info!("[diff-stats] ahead_of_test={} (vs {})", ahead, test);
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!(
                    "[diff-stats] Cannot find test branch ref '{}': {}",
                    test_ref_name,
                    e
                );
            }
        }
    } else {
        log::info!("[diff-stats] No test_branch provided, skipping ahead_of_test");
    }

    // Get changed files count
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(false);

    if let Ok(statuses) = repo.statuses(Some(&mut opts)) {
        stats.changed_files = statuses.len();
    }

    stats
}

/// Detect git platform (GitHub or GitLab)
#[derive(Debug, PartialEq)]
pub enum GitPlatform {
    GitHub,
    GitLab,
    Unknown,
}

fn get_remote_origin_url(path: &Path) -> Result<String, String> {
    let output = git_command()
        .arg("-C")
        .arg(path)
        .arg("remote")
        .arg("get-url")
        .arg("origin")
        .output()
        .map_err(|e| format!("Failed to get remote URL: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to get remote URL: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn remote_url_to_web_url(remote_url: &str) -> Option<String> {
    let url = remote_url.trim();
    if let Some(rest) = url.strip_prefix("git@") {
        let parts: Vec<&str> = rest.splitn(2, ':').collect();
        if parts.len() == 2 {
            let host = parts[0];
            let path = parts[1].trim_end_matches(".git");
            return Some(format!("https://{}/{}", host, path));
        }
    }
    if url.starts_with("https://") || url.starts_with("http://") {
        return Some(url.trim_end_matches(".git").to_string());
    }
    None
}

fn get_current_branch_inner(path: &Path) -> Result<String, String> {
    let output = git_command()
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()
        .map_err(|e| format!("Failed to get current branch: {}", e))?;
    if !output.status.success() {
        return Err("Failed to get current branch".to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn detect_git_platform(path: &Path) -> Result<GitPlatform, String> {
    let remote_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("remote")
        .arg("-v")
        .output()
        .map_err(|e| format!("Failed to execute git remote: {}", e))?;

    if !remote_output.status.success() {
        return Err(format!(
            "Git remote failed: {}",
            String::from_utf8_lossy(&remote_output.stderr)
        ));
    }

    let output_str = String::from_utf8_lossy(&remote_output.stdout);

    // Check for GitHub
    if output_str.contains("github.com") {
        return Ok(GitPlatform::GitHub);
    }

    // Check for GitLab
    if output_str.contains("gitlab.com") || output_str.contains("gitlab") {
        return Ok(GitPlatform::GitLab);
    }

    Ok(GitPlatform::Unknown)
}

/// Create a pull request using gh CLI (GitHub) or git push options (GitLab)
pub fn create_pull_request(
    path: &Path,
    base_branch: &str,
    title: &str,
    body: &str,
) -> Result<String, String> {
    log::info!(
        "[git] Creating pull request: path={}, base_branch={}, title='{}'",
        path.display(),
        base_branch,
        title
    );

    // Detect platform
    let platform = detect_git_platform(path)?;
    log::info!("[git] Detected platform: {:?}", platform);

    match platform {
        GitPlatform::GitHub => {
            // Helper: build compare URL for browser-based PR creation
            let build_compare_url = || -> Option<String> {
                let remote_url = get_remote_origin_url(path).ok()?;
                let web_url = remote_url_to_web_url(&remote_url)?;
                let head = get_current_branch_inner(path).ok()?;
                Some(format!(
                    "{}/compare/{}...{}?expand=1&title={}&body={}",
                    web_url,
                    urlencoding::encode(base_branch),
                    urlencoding::encode(&head),
                    urlencoding::encode(title),
                    urlencoding::encode(body)
                ))
            };

            // Check if gh CLI is available
            log::info!("[git] Checking gh CLI availability");
            let gh_available = command_without_window("gh")
                .arg("--version")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);

            if !gh_available {
                log::info!("[git] gh CLI not available, falling back to browser URL");
                return if let Some(url) = build_compare_url() {
                    log::info!("[git] Browser PR URL: {}", url);
                    Ok(url)
                } else {
                    Err(
                        "gh CLI is not installed. Please install it from https://cli.github.com/"
                            .to_string(),
                    )
                };
            }

            // Create PR using gh CLI
            log::info!(
                "[git] Running: gh pr create --base {} --title '{}'",
                base_branch,
                title
            );
            let pr_output = command_without_window("gh")
                .arg("pr")
                .arg("create")
                .arg("--base")
                .arg(base_branch)
                .arg("--title")
                .arg(title)
                .arg("--body")
                .arg(body)
                .current_dir(path)
                .output()
                .map_err(|e| format!("Failed to execute gh pr create: {}", e))?;

            if !pr_output.status.success() {
                let stderr = String::from_utf8_lossy(&pr_output.stderr);
                log::error!("[git] gh pr create failed: {}", stderr);
                // Fall back to browser URL (e.g. branch not yet pushed, auth issue)
                if let Some(url) = build_compare_url() {
                    log::info!("[git] Falling back to browser PR URL: {}", url);
                    return Ok(url);
                }
                return Err(format!("Failed to create PR: {}", stderr));
            }

            let pr_url = String::from_utf8_lossy(&pr_output.stdout)
                .trim()
                .to_string();
            log::info!("[git] Successfully created GitHub PR: {}", pr_url);
            Ok(pr_url)
        }
        GitPlatform::GitLab => {
            log::info!("[git] Creating GitLab MR");
            let current_branch = get_current_branch_inner(path)?;

            // Helper: build browser URL for GitLab MR creation
            let build_mr_browser_url = || -> Option<String> {
                let remote_url = get_remote_origin_url(path).ok()?;
                let web_url = remote_url_to_web_url(&remote_url)?;
                Some(format!(
                    "{}/-/merge_requests/new?merge_request[source_branch]={}&merge_request[target_branch]={}&merge_request[title]={}&merge_request[description]={}",
                    web_url,
                    urlencoding::encode(&current_branch),
                    urlencoding::encode(base_branch),
                    urlencoding::encode(title),
                    urlencoding::encode(body)
                ))
            };

            // Try: push with merge request creation options (GitLab push options)
            log::info!(
                "[git] Running: git push -u origin {} with MR options (target={})",
                current_branch,
                base_branch
            );
            let mut push_cmd = git_command();
            push_cmd
                .arg("-C")
                .arg(path)
                .arg("push")
                .arg("-u")
                .arg("origin")
                .arg(&current_branch)
                .arg("--no-verify")
                .arg("-o")
                .arg("merge_request.create")
                .arg("-o")
                .arg(format!("merge_request.target={}", base_branch))
                .arg("-o")
                .arg(format!("merge_request.title={}", title))
                .arg("-o")
                .arg(format!("merge_request.description={}", body));
            let push_output = run_git_logged(&mut push_cmd, "create pull request gitlab push")
                .map_err(|e| format!("Failed to push and create MR: {}", e))?;

            if !push_output.status.success() {
                let stderr = String::from_utf8_lossy(&push_output.stderr);
                log::error!("[git] GitLab push+MR failed: {}", stderr);
                // Fall back to browser URL
                if let Some(url) = build_mr_browser_url() {
                    log::info!("[git] Falling back to browser MR URL: {}", url);
                    return Ok(url);
                }
                return Err(format!("Failed to create MR: {}", stderr));
            }

            // Extract MR URL from push stderr output
            let output_str = String::from_utf8_lossy(&push_output.stderr);
            for line in output_str.lines() {
                if line.contains("merge_request") || line.contains("/merge_requests/") {
                    if let Some(url_start) = line.find("http") {
                        let url_part = &line[url_start..];
                        let url = if let Some(url_end) = url_part.find(char::is_whitespace) {
                            url_part[..url_end].to_string()
                        } else {
                            url_part.to_string()
                        };
                        log::info!("[git] GitLab MR URL extracted: {}", url);
                        return Ok(url);
                    }
                }
            }

            // URL not in push output - return browser URL for user to open
            log::info!(
                "[git] GitLab MR created for branch {} -> {} (URL not extracted, using browser fallback)",
                current_branch,
                base_branch
            );
            if let Some(url) = build_mr_browser_url() {
                Ok(url)
            } else {
                Ok(format!(
                    "MR created successfully for branch {} -> {}",
                    current_branch, base_branch
                ))
            }
        }
        GitPlatform::Unknown => {
            log::error!("[git] Unknown git platform, cannot create PR");
            Err("Unknown git platform. Only GitHub and GitLab are supported.".to_string())
        }
    }
}

/// Fetch from remote origin (updates remote-tracking branches)
pub fn fetch_remote(path: &Path) -> Result<(), String> {
    log::info!("[git] Fetching remote origin: path={}", path.display());
    let mut fetch_cmd = git_command();
    fetch_cmd.arg("-C").arg(path).arg("fetch").arg("origin");
    let output = run_git_logged(&mut fetch_cmd, "fetch remote")
        .map_err(|e| format!("Failed to execute git fetch: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("[git] Fetch failed for {}: {}", path.display(), stderr);
        return Err(format!("Git fetch failed: {}", stderr));
    }

    log::info!("[git] Fetch succeeded for {}", path.display());
    Ok(())
}

/// Check if a remote branch exists
pub fn check_remote_branch_exists(path: &Path, branch_name: &str) -> Result<bool, String> {
    log::debug!(
        "[git] Checking remote branch exists: path={}, branch=origin/{}",
        path.display(),
        branch_name
    );
    // Check locally if the remote-tracking branch exists (no network call).
    // Remote-tracking branches are updated by git fetch/pull/push operations,
    // so this is accurate enough for UI button state.
    let output = git_command()
        .arg("-C")
        .arg(path)
        .arg("branch")
        .arg("-r")
        .arg("--list")
        .arg(format!("origin/{}", branch_name))
        .output()
        .map_err(|e| format!("Failed to execute git branch: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!(
            "[git] Branch check failed for origin/{}: {}",
            branch_name,
            stderr
        );
        return Err(format!("Git branch check failed: {}", stderr));
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    let exists = !output_str.trim().is_empty();
    log::debug!(
        "[git] Remote branch origin/{} exists: {}",
        branch_name,
        exists
    );
    Ok(exists)
}

/// Get list of remote branches
pub fn get_remote_branches(path: &Path) -> Result<Vec<String>, String> {
    log::info!("[git] Getting remote branches: path={}", path.display());

    // Fetch from remote to ensure we have the latest branch info
    log::info!("[git] Step 1/2: git fetch origin");
    let mut fetch_cmd = git_command();
    fetch_cmd.arg("-C").arg(path).arg("fetch").arg("origin");
    let fetch_output = run_git_logged(&mut fetch_cmd, "get remote branches fetch")
        .map_err(|e| format!("Failed to execute git fetch: {}", e))?;

    if !fetch_output.status.success() {
        let stderr = String::from_utf8_lossy(&fetch_output.stderr);
        log::error!("[git] Step 1/2 FAILED: git fetch: {}", stderr);
        return Err(format!("Git fetch failed: {}", stderr));
    }

    // Get list of remote branches
    log::info!("[git] Step 2/2: git ls-remote --heads origin");
    let ls_remote_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("ls-remote")
        .arg("--heads")
        .arg("origin")
        .output()
        .map_err(|e| format!("Failed to execute git ls-remote: {}", e))?;

    if !ls_remote_output.status.success() {
        let stderr = String::from_utf8_lossy(&ls_remote_output.stderr);
        log::error!("[git] Step 2/2 FAILED: git ls-remote: {}", stderr);
        return Err(format!("Git ls-remote failed: {}", stderr));
    }

    let output_str = String::from_utf8_lossy(&ls_remote_output.stdout);
    let branches: Vec<String> = output_str
        .lines()
        .filter_map(|line| {
            // Format: <hash>\trefs/heads/<branch-name>
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() == 2 {
                parts[1].strip_prefix("refs/heads/").map(|s| s.to_string())
            } else {
                None
            }
        })
        .collect();

    log::info!("[git] Found {} remote branches", branches.len());
    Ok(branches)
}

/// Get combined git diff for AI commit message generation
pub fn get_git_diff(path: &Path) -> Result<String, String> {
    log::info!("[git] Getting diff for: {}", path.display());

    // Get staged diff
    let staged = git_command()
        .arg("-C")
        .arg(path)
        .args(["diff", "--cached", "--stat"])
        .output()
        .map_err(|e| format!("Failed to get staged diff: {}", e))?;

    // Get unstaged diff (tracked files)
    let unstaged = git_command()
        .arg("-C")
        .arg(path)
        .args(["diff", "--stat"])
        .output()
        .map_err(|e| format!("Failed to get unstaged diff: {}", e))?;

    // Get untracked files
    let untracked = git_command()
        .arg("-C")
        .arg(path)
        .args(["ls-files", "--others", "--exclude-standard"])
        .output()
        .map_err(|e| format!("Failed to get untracked files: {}", e))?;

    // Also get a compact diff of actual content changes (limited size for AI)
    let content_diff = git_command()
        .arg("-C")
        .arg(path)
        .args(["diff", "HEAD", "--no-color", "-U2"])
        .output()
        .map_err(|e| format!("Failed to get content diff: {}", e))?;

    let mut result = String::new();

    let staged_str = String::from_utf8_lossy(&staged.stdout);
    if !staged_str.trim().is_empty() {
        result.push_str("Staged changes:\n");
        result.push_str(&staged_str);
        result.push('\n');
    }

    let unstaged_str = String::from_utf8_lossy(&unstaged.stdout);
    if !unstaged_str.trim().is_empty() {
        result.push_str("Unstaged changes:\n");
        result.push_str(&unstaged_str);
        result.push('\n');
    }

    let untracked_str = String::from_utf8_lossy(&untracked.stdout);
    if !untracked_str.trim().is_empty() {
        result.push_str("New files:\n");
        result.push_str(&untracked_str);
        result.push('\n');
    }

    let diff_str = String::from_utf8_lossy(&content_diff.stdout);
    if !diff_str.trim().is_empty() {
        // Truncate to ~4000 chars to keep token usage reasonable
        let truncated: String = diff_str.chars().take(4000).collect();
        result.push_str("Diff:\n");
        result.push_str(&truncated);
        if diff_str.len() > 4000 {
            result.push_str("\n... (truncated)");
        }
    }

    if result.trim().is_empty() {
        return Err("No changes to commit".to_string());
    }

    Ok(result)
}

/// Stage all changes and commit with the given message
pub fn commit_all(
    path: &Path,
    message: &str,
    author_name: Option<&str>,
    author_email: Option<&str>,
    skip_hooks: bool,
) -> Result<String, String> {
    log::info!(
        "[git] Committing all changes at: {}, skip_hooks={}",
        path.display(),
        skip_hooks
    );

    // git add -A
    let add_output = git_command()
        .arg("-C")
        .arg(path)
        .args(["add", "-A"])
        .output()
        .map_err(|e| format!("Failed to stage changes: {}", e))?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!("git add failed: {}", stderr));
    }

    // git commit -m with optional author override
    let mut cmd = git_command();
    cmd.arg("-C").arg(path);
    if let Some(name) = author_name {
        cmd.env("GIT_AUTHOR_NAME", name)
            .env("GIT_COMMITTER_NAME", name);
    }
    if let Some(email) = author_email {
        cmd.env("GIT_AUTHOR_EMAIL", email)
            .env("GIT_COMMITTER_EMAIL", email);
    }
    let mut args = vec!["commit", "-m", message];
    if skip_hooks {
        args.push("--no-verify");
    }
    let commit_output = cmd
        .args(args)
        .output()
        .map_err(|e| format!("Failed to commit: {}", e))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        return Err(format!("git commit failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&commit_output.stdout)
        .trim()
        .to_string();
    log::info!("[git] Commit successful: {}", stdout);
    Ok(format!("Committed: {}", message))
}

/// Get local git user.name and user.email config
pub fn get_git_user_config(path: &Path) -> Result<(Option<String>, Option<String>), String> {
    let name_output = git_command()
        .arg("-C")
        .arg(path)
        .args(["config", "--local", "user.name"])
        .output()
        .map_err(|e| format!("Failed to get user.name: {}", e))?;
    let name = if name_output.status.success() {
        Some(
            String::from_utf8_lossy(&name_output.stdout)
                .trim()
                .to_string(),
        )
    } else {
        None
    };

    let email_output = git_command()
        .arg("-C")
        .arg(path)
        .args(["config", "--local", "user.email"])
        .output()
        .map_err(|e| format!("Failed to get user.email: {}", e))?;
    let email = if email_output.status.success() {
        Some(
            String::from_utf8_lossy(&email_output.stdout)
                .trim()
                .to_string(),
        )
    } else {
        None
    };

    Ok((name, email))
}

/// Set local git user.name and user.email config
pub fn set_git_user_config(
    path: &Path,
    name: Option<&str>,
    email: Option<&str>,
) -> Result<(), String> {
    if let Some(name) = name {
        let output = git_command()
            .arg("-C")
            .arg(path)
            .args(["config", "user.name", name])
            .output()
            .map_err(|e| format!("Failed to set user.name: {}", e))?;
        if !output.status.success() {
            return Err(format!(
                "git config user.name failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }
    if let Some(email) = email {
        let output = git_command()
            .arg("-C")
            .arg(path)
            .args(["config", "user.email", email])
            .output()
            .map_err(|e| format!("Failed to set user.email: {}", e))?;
        if !output.status.success() {
            return Err(format!(
                "git config user.email failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }
    Ok(())
}

// ==================== Changed Files API ====================

#[derive(Debug, Serialize, Clone)]
pub struct ChangedFile {
    pub path: String,
    pub status: String, // "M" | "A" | "D" | "R" | "?" (untracked) | "C" (copied)
    pub staged: bool,
}

/// Get list of changed files in a git repo using `git status --porcelain=v1`.
pub fn get_changed_files(path: &Path) -> Result<Vec<ChangedFile>, String> {
    let output = git_command()
        .arg("-C")
        .arg(path)
        .args(["status", "--porcelain=v1"])
        .output()
        .map_err(|e| format!("Failed to get git status: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git status failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();

    for line in stdout.lines() {
        if line.len() < 4 {
            continue;
        }
        let index_status = line.chars().next().unwrap_or(' ');
        let worktree_status = line.chars().nth(1).unwrap_or(' ');
        let file_path = line[3..].to_string();

        // Handle rename: "R  old -> new"
        let file_path = if file_path.contains(" -> ") {
            file_path
                .split(" -> ")
                .last()
                .unwrap_or(&file_path)
                .to_string()
        } else {
            file_path
        };

        // Determine status and staged state
        let (status, staged) = match (index_status, worktree_status) {
            ('?', '?') => ("?".to_string(), false), // untracked
            ('A', _) => ("A".to_string(), true),    // added (staged)
            ('D', _) => ("D".to_string(), true),    // deleted (staged)
            ('R', _) => ("R".to_string(), true),    // renamed (staged)
            ('C', _) => ("C".to_string(), true),    // copied (staged)
            ('M', _) => ("M".to_string(), true),    // modified (staged)
            (_, 'M') => ("M".to_string(), false),   // modified (unstaged)
            (_, 'D') => ("D".to_string(), false),   // deleted (unstaged)
            _ => ("M".to_string(), false),          // fallback
        };

        files.push(ChangedFile {
            path: file_path,
            status,
            staged,
        });
    }

    Ok(files)
}

#[derive(Debug, Serialize, Clone)]
pub struct FileDiff {
    pub file_path: String,
    pub old_content: String,
    pub new_content: String,
    pub is_new: bool,
    pub is_deleted: bool,
    pub is_binary: bool,
}

/// Get old (HEAD) and new (working tree) content for a single file for side-by-side diff.
pub fn get_file_diff(path: &Path, file_path: &str) -> Result<FileDiff, String> {
    // Security: `file_path` is client-controlled and this is reachable over the shared HTTP
    // surface. Constrain the read to within the repository so a remote client cannot exfiltrate
    // arbitrary host files (e.g. /etc/passwd, ~/.ssh/id_rsa, .env) via an absolute path or `..`
    // traversal. Note `Path::join` silently discards the base when the arg is absolute.
    let rel = Path::new(file_path);
    if rel.components().any(|c| {
        matches!(
            c,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return Err("Invalid file path".to_string());
    }

    let full_path = path.join(file_path);

    // Defense-in-depth: if the resolved file exists, ensure it did not escape the repo root
    // through a symlink. Non-existent (deleted) files cannot be canonicalized, so they skip
    // this check but are already covered by the lexical guard above.
    if full_path.exists() {
        match (path.canonicalize(), full_path.canonicalize()) {
            (Ok(root), Ok(resolved)) if resolved.starts_with(&root) => {}
            _ => return Err("Invalid file path".to_string()),
        }
    }

    // Try to get old content from HEAD
    let old_output = git_command()
        .arg("-C")
        .arg(path)
        .args(["show", &format!("HEAD:{}", file_path)])
        .output();

    let old_content = match old_output {
        Ok(out) if out.status.success() => {
            // Check if binary
            let raw = &out.stdout;
            if raw.contains(&0u8) {
                return Ok(FileDiff {
                    file_path: file_path.to_string(),
                    old_content: String::new(),
                    new_content: String::new(),
                    is_new: false,
                    is_deleted: false,
                    is_binary: true,
                });
            }
            String::from_utf8_lossy(raw).to_string()
        }
        _ => String::new(), // File doesn't exist in HEAD (new file)
    };

    let is_new = old_content.is_empty();

    // Get new content from working tree
    let new_content = if full_path.exists() {
        match std::fs::read(&full_path) {
            Ok(bytes) => {
                if bytes.contains(&0u8) {
                    return Ok(FileDiff {
                        file_path: file_path.to_string(),
                        old_content: String::new(),
                        new_content: String::new(),
                        is_new,
                        is_deleted: false,
                        is_binary: true,
                    });
                }
                String::from_utf8_lossy(&bytes).to_string()
            }
            Err(_) => String::new(),
        }
    } else {
        String::new() // File deleted
    };

    let is_deleted = new_content.is_empty() && !is_new;

    Ok(FileDiff {
        file_path: file_path.to_string(),
        old_content,
        new_content,
        is_new,
        is_deleted,
        is_binary: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::process::Command;
    use tempfile::TempDir;

    fn run_git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_output(repo: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn make_test_repo() -> TempDir {
        let temp = tempfile::tempdir().expect("create temp repo");
        let repo = temp.path();

        run_git(repo, &["init"]);
        run_git(repo, &["checkout", "-b", "main"]);
        run_git(repo, &["config", "user.email", "test@example.com"]);
        run_git(repo, &["config", "user.name", "Test User"]);

        std::fs::write(repo.join("README.md"), "initial\n").expect("write initial file");
        run_git(repo, &["add", "README.md"]);
        run_git(repo, &["commit", "-m", "initial commit"]);
        run_git(repo, &["branch", "test"]);

        let origin_path = repo.join(".git").join("origin.git");
        let output = Command::new("git")
            .args(["init", "--bare"])
            .arg(&origin_path)
            .output()
            .expect("init bare origin");
        assert!(
            output.status.success(),
            "git init --bare failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        run_git(
            repo,
            &["remote", "add", "origin", origin_path.to_str().unwrap()],
        );
        run_git(repo, &["push", "origin", "main"]);
        run_git(repo, &["push", "origin", "test"]);
        run_git(repo, &["fetch", "origin"]);

        run_git(repo, &["checkout", "-b", "feature/demo"]);
        std::fs::write(repo.join("feature.txt"), "feature\n").expect("write feature file");
        run_git(repo, &["add", "feature.txt"]);
        run_git(repo, &["commit", "-m", "feature commit"]);

        temp
    }

    #[serial]
    #[test]
    fn get_file_diff_rejects_traversal_and_absolute_paths() {
        let temp = make_test_repo();
        let repo = temp.path();

        // A legitimate repo-relative path still works.
        assert!(
            get_file_diff(repo, "feature.txt").is_ok(),
            "in-repo file should be readable"
        );

        // Absolute paths must be rejected so /etc/passwd etc. cannot be exfiltrated.
        assert!(get_file_diff(repo, "/etc/passwd").is_err());

        // Parent-dir traversal must be rejected, whether or not the target exists.
        assert!(get_file_diff(repo, "../../../../etc/passwd").is_err());
        assert!(get_file_diff(repo, "../feature.txt").is_err());
    }

    fn clone_repo(origin_path: &Path, clone_path: &Path) {
        let output = Command::new("git")
            .arg("clone")
            .arg(origin_path)
            .arg(clone_path)
            .output()
            .expect("clone repo");
        assert!(
            output.status.success(),
            "git clone {} {} failed\nstdout:\n{}\nstderr:\n{}",
            origin_path.display(),
            clone_path.display(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn changed_file<'a>(files: &'a [ChangedFile], path: &str) -> &'a ChangedFile {
        files
            .iter()
            .find(|file| file.path == path)
            .unwrap_or_else(|| panic!("missing changed file {path}; got {files:?}"))
    }

    #[test]
    fn is_push_rejected_non_fast_forward_matches_real_git_rejections_only() {
        let fetch_first = "To /tmp/origin.git\n \
             ! [rejected]        HEAD -> test (fetch first)\n\
             error: failed to push some refs to '/tmp/origin.git'\n\
             hint: Updates were rejected because the remote contains work that you do not\n\
             hint: have locally. This is usually caused by another repository pushing to\n\
             hint: the same ref. If you want to integrate the remote changes, use\n\
             hint: 'git pull' before pushing again.";
        let non_fast_forward = "To https://github.com/acme/app.git\n \
             ! [rejected]        test -> test (non-fast-forward)\n\
             error: failed to push some refs to 'https://github.com/acme/app.git'\n\
             hint: Updates were rejected because the tip of your current branch is behind\n\
             hint: its remote counterpart.";
        let stale_info = "To https://github.com/acme/app.git\n \
             ! [rejected]        test -> test (stale info)\n\
             error: failed to push some refs to 'https://github.com/acme/app.git'";

        assert!(is_push_rejected_non_fast_forward(fetch_first));
        assert!(is_push_rejected_non_fast_forward(non_fast_forward));
        assert!(is_push_rejected_non_fast_forward(stale_info));
        assert!(is_push_rejected_non_fast_forward(
            "! [rejected] test -> test (non-fast-forward)"
        ));

        // Anything that a second fetch/merge/push cannot fix must not trigger a retry.
        assert!(!is_push_rejected_non_fast_forward(""));
        assert!(!is_push_rejected_non_fast_forward(
            "fatal: unable to access 'https://github.com/acme/app.git/': \
             Could not resolve host: github.com"
        ));
        assert!(!is_push_rejected_non_fast_forward(
            "remote: Permission to acme/app.git denied to bob.\n\
             fatal: unable to access 'https://github.com/acme/app.git/': \
             The requested URL returned error: 403"
        ));
        assert!(!is_push_rejected_non_fast_forward(
            "fatal: Authentication failed for 'https://github.com/acme/app.git/'"
        ));
        assert!(!is_push_rejected_non_fast_forward(
            "To https://github.com/acme/app.git\n \
             ! [remote rejected] test -> test (pre-receive hook declined)\n\
             error: failed to push some refs to 'https://github.com/acme/app.git'"
        ));
        assert!(!is_push_rejected_non_fast_forward("Everything up-to-date"));
    }

    #[test]
    fn parse_worktree_list_porcelain_reads_branches_and_skips_detached_bare_and_prunable() {
        let output = "worktree /work/main\n\
                      HEAD 1111111111111111111111111111111111111111\n\
                      branch refs/heads/test\n\
                      \n\
                      worktree /work/feature\n\
                      HEAD 2222222222222222222222222222222222222222\n\
                      detached\n\
                      \n\
                      worktree /work/locked\n\
                      HEAD 3333333333333333333333333333333333333333\n\
                      branch refs/heads/main\n\
                      locked reason with spaces\n\
                      \n\
                      worktree /work/gone\n\
                      HEAD 4444444444444444444444444444444444444444\n\
                      branch refs/heads/test\n\
                      prunable gitdir file points to non-existent location\n\
                      \n\
                      worktree C:/work/windows\r\n\
                      HEAD 5555555555555555555555555555555555555555\r\n\
                      branch refs/heads/test\r\n\
                      \r\n\
                      worktree /work/bare.git\n\
                      bare\n";

        let parsed = parse_worktree_list_porcelain(output);

        assert_eq!(
            parsed,
            vec![
                (
                    std::path::PathBuf::from("/work/main"),
                    Some("refs/heads/test".to_string())
                ),
                (std::path::PathBuf::from("/work/feature"), None),
                (
                    std::path::PathBuf::from("/work/locked"),
                    Some("refs/heads/main".to_string())
                ),
                (
                    std::path::PathBuf::from("C:/work/windows"),
                    Some("refs/heads/test".to_string())
                ),
                (std::path::PathBuf::from("/work/bare.git"), None),
            ]
        );
        assert!(parse_worktree_list_porcelain("").is_empty());
    }

    #[serial]
    #[test]
    fn get_changed_files_marks_merge_conflict_as_unstaged_modified() {
        let repo = make_test_repo();
        let path = repo.path();

        std::fs::write(path.join("README.md"), "feature side\n").expect("write feature side");
        run_git(path, &["add", "README.md"]);
        run_git(path, &["commit", "-m", "feature readme conflict"]);
        run_git(path, &["checkout", "main"]);
        std::fs::write(path.join("README.md"), "main side\n").expect("write main side");
        run_git(path, &["add", "README.md"]);
        run_git(path, &["commit", "-m", "main readme conflict"]);
        run_git(path, &["checkout", "feature/demo"]);

        let merge = Command::new("git")
            .args(["merge", "main"])
            .current_dir(path)
            .output()
            .expect("run conflicting merge");
        assert!(!merge.status.success(), "merge should conflict");

        let files = get_changed_files(path).expect("get conflict status");
        let conflicted = changed_file(&files, "README.md");
        assert_eq!(conflicted.status, "M");
        assert!(!conflicted.staged);

        run_git(path, &["merge", "--abort"]);
    }

    #[serial]
    #[test]
    fn get_git_user_config_returns_none_for_unset_local_values() {
        let repo = make_test_repo();
        let path = repo.path();
        run_git(path, &["config", "--unset", "user.name"]);
        run_git(path, &["config", "--unset", "user.email"]);

        let (name, email) = get_git_user_config(path).expect("read unset local config");

        assert_eq!(name, None);
        assert_eq!(email, None);
    }

    #[cfg(unix)]
    #[serial]
    #[test]
    fn commit_all_skip_hooks_bypasses_failing_pre_commit_hook() {
        use std::os::unix::fs::PermissionsExt;

        let repo = make_test_repo();
        let path = repo.path();
        let hook = path.join(".git").join("hooks").join("pre-commit");
        std::fs::write(&hook, "#!/bin/sh\nexit 1\n").expect("write failing pre-commit hook");
        let mut permissions = std::fs::metadata(&hook)
            .expect("read hook metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&hook, permissions).expect("make hook executable");

        std::fs::write(path.join("hooked.txt"), "hooked\n").expect("write hooked file");
        let err = commit_all(path, "hook should fail", None, None, false).unwrap_err();
        assert!(err.contains("git commit failed"), "{err}");

        let committed =
            commit_all(path, "hook skipped", None, None, true).expect("commit bypasses hook");

        assert_eq!(committed, "Committed: hook skipped");
        assert_eq!(
            git_output(path, &["log", "-1", "--format=%s"]),
            "hook skipped"
        );
    }

    #[serial]
    #[test]
    fn remote_url_to_web_url_handles_trimmed_http_and_nested_ssh_forms() {
        assert_eq!(
            remote_url_to_web_url(" https://github.com/owner/repo.git ").as_deref(),
            Some("https://github.com/owner/repo")
        );
        assert_eq!(
            remote_url_to_web_url("http://gitlab.local/group/repo").as_deref(),
            Some("http://gitlab.local/group/repo")
        );
        assert_eq!(
            remote_url_to_web_url("git@gitlab.example.com:group/sub/repo.git").as_deref(),
            Some("https://gitlab.example.com/group/sub/repo")
        );
        assert_eq!(
            remote_url_to_web_url("ssh://git@example.com/group/repo.git"),
            None
        );
    }

    #[serial]
    #[test]
    fn detect_git_platform_errors_for_non_git_directory() {
        let non_git = tempfile::tempdir().expect("create non-git dir");

        let err = detect_git_platform(non_git.path()).unwrap_err();

        assert!(err.contains("Git remote failed"), "{err}");
    }

    #[serial]
    #[test]
    fn get_remote_origin_url_reports_missing_origin_remote() {
        let repo = tempfile::tempdir().expect("create repo without origin");
        run_git(repo.path(), &["init"]);

        let err = get_remote_origin_url(repo.path()).unwrap_err();

        assert!(err.contains("Failed to get remote URL"), "{err}");
    }

    #[serial]
    #[test]
    fn get_branch_status_returns_default_for_non_git_directory() {
        let non_git = tempfile::tempdir().expect("create non-git dir");

        let status = get_branch_status(non_git.path(), "project-a", "main");

        assert_eq!(status.project_name, "project-a");
        assert_eq!(status.branch_name, "unknown");
        assert!(!status.has_uncommitted);
        assert_eq!(status.uncommitted_count, 0);
        assert!(!status.is_pushed);
        assert_eq!(status.unpushed_commits, 0);
        assert!(!status.has_merge_request);
        assert_eq!(status.remote_url, "");
    }

    #[serial]
    #[test]
    fn get_worktree_info_counts_behind_base_after_remote_advances() {
        let repo = make_test_repo();
        let path = repo.path();
        let origin_url = git_output(path, &["remote", "get-url", "origin"]);
        let upstream = tempfile::tempdir().expect("create upstream clone dir");
        clone_repo(Path::new(&origin_url), upstream.path());
        run_git(upstream.path(), &["checkout", "main"]);
        run_git(
            upstream.path(),
            &["config", "user.email", "upstream@example.com"],
        );
        run_git(upstream.path(), &["config", "user.name", "Upstream User"]);
        std::fs::write(upstream.path().join("main-only.txt"), "main only\n")
            .expect("write upstream main file");
        run_git(upstream.path(), &["add", "main-only.txt"]);
        run_git(upstream.path(), &["commit", "-m", "advance main"]);
        run_git(upstream.path(), &["push", "origin", "main"]);
        run_git(path, &["fetch", "origin"]);

        let info = get_worktree_info_for_branches(path, "main", "test");

        assert_eq!(info.current_branch, "feature/demo");
        assert_eq!(info.ahead_of_base, 1);
        assert_eq!(info.behind_base, 1);
        assert!(!info.is_merged_to_base);
    }

    #[serial]
    #[test]
    fn get_branch_diff_stats_counts_behind_base_after_remote_advances() {
        let repo = make_test_repo();
        let path = repo.path();
        let origin_url = git_output(path, &["remote", "get-url", "origin"]);
        let upstream = tempfile::tempdir().expect("create upstream clone dir");
        clone_repo(Path::new(&origin_url), upstream.path());
        run_git(upstream.path(), &["checkout", "main"]);
        run_git(
            upstream.path(),
            &["config", "user.email", "upstream@example.com"],
        );
        run_git(upstream.path(), &["config", "user.name", "Upstream User"]);
        std::fs::write(upstream.path().join("remote-main.txt"), "remote main\n")
            .expect("write remote main file");
        run_git(upstream.path(), &["add", "remote-main.txt"]);
        run_git(upstream.path(), &["commit", "-m", "remote main commit"]);
        run_git(upstream.path(), &["push", "origin", "main"]);
        run_git(path, &["fetch", "origin"]);

        let stats = get_branch_diff_stats(path, "main", Some("test"));

        assert_eq!(stats.ahead, 1);
        assert_eq!(stats.behind, 1);
        assert_eq!(stats.unpushed_commits, 1);
        assert_eq!(stats.ahead_of_test, 1);
    }

    #[serial]
    #[test]
    fn get_git_diff_includes_staged_sections_for_added_modified_and_deleted_files() {
        let repo = make_test_repo();
        let path = repo.path();
        std::fs::write(path.join("README.md"), "staged readme\n").expect("modify readme");
        std::fs::write(path.join("staged-new.txt"), "staged new\n").expect("write staged file");
        run_git(path, &["rm", "feature.txt"]);
        run_git(path, &["add", "README.md", "staged-new.txt"]);

        let diff = get_git_diff(path).expect("get staged diff");

        assert!(diff.contains("Staged changes:"), "{diff}");
        assert!(diff.contains("README.md"), "{diff}");
        assert!(diff.contains("staged-new.txt"), "{diff}");
        assert!(diff.contains("feature.txt"), "{diff}");
        assert!(diff.contains("Diff:"), "{diff}");
    }

    #[serial]
    #[test]
    fn get_file_diff_reports_absent_never_tracked_file_as_new_empty_file() {
        let repo = make_test_repo();

        let diff = get_file_diff(repo.path(), "missing.txt").expect("missing file diff");

        assert_eq!(diff.file_path, "missing.txt");
        assert_eq!(diff.old_content, "");
        assert_eq!(diff.new_content, "");
        assert!(diff.is_new);
        assert!(!diff.is_deleted);
        assert!(!diff.is_binary);
    }

    #[serial]
    #[test]
    fn set_git_user_config_updates_name_and_email_independently() {
        let repo = make_test_repo();
        let path = repo.path();
        run_git(path, &["config", "--unset", "user.name"]);
        run_git(path, &["config", "--unset", "user.email"]);

        set_git_user_config(path, Some("Only Name"), None).expect("set only name");
        let (name, email) = get_git_user_config(path).expect("get name-only config");
        assert_eq!(name.as_deref(), Some("Only Name"));
        assert_eq!(email, None);

        set_git_user_config(path, None, Some("only-email@example.com")).expect("set only email");
        let (name, email) = get_git_user_config(path).expect("get partial config");
        assert_eq!(name.as_deref(), Some("Only Name"));
        assert_eq!(email.as_deref(), Some("only-email@example.com"));
    }

    #[serial]
    #[test]
    fn check_remote_branch_exists_returns_false_for_missing_tracking_branch() {
        let repo = make_test_repo();

        let exists = check_remote_branch_exists(repo.path(), "does-not-exist")
            .expect("missing tracking branch check succeeds");

        assert!(!exists);
    }

    #[serial]
    #[test]
    fn get_worktree_info_reports_branch_remote_ahead_and_uncommitted_counts() {
        let repo = make_test_repo();
        let path = repo.path();
        std::fs::write(path.join("untracked.txt"), "new\n").expect("write untracked file");

        let info = get_worktree_info_for_branches(path, "main", "test");

        assert_eq!(info.current_branch, "feature/demo");
        assert_eq!(info.uncommitted_count, 1);
        assert_eq!(info.ahead_of_base, 1);
        assert_eq!(info.ahead_of_test, 1);
        assert_eq!(info.unpushed_commits, 1);
        assert!(info.remote_url.ends_with(".git/origin.git"));
        assert!(!info.is_merged_to_base);
        assert!(!info.is_merged_to_test);
    }

    #[serial]
    #[test]
    fn get_worktree_info_returns_default_for_non_git_directory() {
        let dir = tempfile::tempdir().expect("create non-git dir");

        let info = get_worktree_info(dir.path());

        assert_eq!(info.current_branch, "unknown");
        assert_eq!(info.uncommitted_count, 0);
        assert_eq!(info.ahead_of_base, 0);
        assert_eq!(info.remote_url, "");
    }

    #[serial]
    #[test]
    fn get_branch_status_distinguishes_pushed_main_from_unpushed_feature() {
        let repo = make_test_repo();
        let path = repo.path();

        let feature_status = get_branch_status(path, "demo", "main");
        assert_eq!(feature_status.project_name, "demo");
        assert_eq!(feature_status.branch_name, "feature/demo");
        assert!(!feature_status.is_pushed);
        assert_eq!(feature_status.unpushed_commits, 1);
        assert!(!feature_status.has_uncommitted);

        run_git(path, &["checkout", "main"]);
        let main_status = get_branch_status(path, "demo", "main");
        assert_eq!(main_status.branch_name, "main");
        assert!(main_status.is_pushed);
        assert_eq!(main_status.unpushed_commits, 0);
        assert_eq!(main_status.remote_url, feature_status.remote_url);
    }

    #[serial]
    #[test]
    fn get_branch_status_counts_untracked_worktree_changes() {
        let repo = make_test_repo();
        let path = repo.path();
        std::fs::write(path.join("local.txt"), "local\n").expect("write local file");

        let status = get_branch_status(path, "demo", "main");

        assert!(status.has_uncommitted);
        assert_eq!(status.uncommitted_count, 1);
        assert_eq!(status.branch_name, "feature/demo");
    }

    #[serial]
    #[test]
    fn check_remote_branch_exists_uses_local_tracking_refs_and_errors_for_non_git() {
        let repo = make_test_repo();

        assert_eq!(
            check_remote_branch_exists(repo.path(), "main").expect("check main"),
            true
        );
        assert_eq!(
            check_remote_branch_exists(repo.path(), "missing").expect("check missing"),
            false
        );

        let non_git = tempfile::tempdir().expect("create non-git dir");
        let err = check_remote_branch_exists(non_git.path(), "main").unwrap_err();
        assert!(err.contains("Git branch check failed"), "{err}");
    }

    #[serial]
    #[test]
    fn get_current_branch_inner_reads_branch_and_errors_for_non_git() {
        let repo = make_test_repo();

        assert_eq!(
            get_current_branch_inner(repo.path()).expect("read current branch"),
            "feature/demo"
        );

        let non_git = tempfile::tempdir().expect("create non-git dir");
        let err = get_current_branch_inner(non_git.path()).unwrap_err();
        assert_eq!(err, "Failed to get current branch");
    }

    #[serial]
    #[test]
    fn get_changed_files_parses_unstaged_staged_and_untracked_entries() {
        let repo = make_test_repo();
        let path = repo.path();
        std::fs::write(path.join("README.md"), "changed\n").expect("modify readme");
        std::fs::write(path.join("staged.txt"), "staged\n").expect("write staged file");
        run_git(path, &["add", "staged.txt"]);
        std::fs::write(path.join("untracked.txt"), "untracked\n").expect("write untracked file");

        let files = get_changed_files(path).expect("get changed files");

        let modified = changed_file(&files, "README.md");
        assert_eq!(modified.status, "M");
        assert!(!modified.staged);

        let staged = changed_file(&files, "staged.txt");
        assert_eq!(staged.status, "A");
        assert!(staged.staged);

        let untracked = changed_file(&files, "untracked.txt");
        assert_eq!(untracked.status, "?");
        assert!(!untracked.staged);
    }

    #[serial]
    #[test]
    fn get_changed_files_returns_git_status_error_for_non_git_directory() {
        let non_git = tempfile::tempdir().expect("create non-git dir");

        let err = get_changed_files(non_git.path()).unwrap_err();

        assert!(err.contains("git status failed"), "{err}");
        assert!(err.contains("not a git repository"), "{err}");
    }

    #[serial]
    #[test]
    fn get_file_diff_reports_modified_new_deleted_and_binary_files() {
        let repo = make_test_repo();
        let path = repo.path();

        std::fs::write(path.join("README.md"), "changed\n").expect("modify readme");
        let modified = get_file_diff(path, "README.md").expect("modified diff");
        assert_eq!(modified.file_path, "README.md");
        assert_eq!(modified.old_content, "initial\n");
        assert_eq!(modified.new_content, "changed\n");
        assert!(!modified.is_new);
        assert!(!modified.is_deleted);
        assert!(!modified.is_binary);

        std::fs::write(path.join("new.txt"), "new\n").expect("write new file");
        let new_file = get_file_diff(path, "new.txt").expect("new file diff");
        assert_eq!(new_file.old_content, "");
        assert_eq!(new_file.new_content, "new\n");
        assert!(new_file.is_new);
        assert!(!new_file.is_deleted);

        std::fs::remove_file(path.join("README.md")).expect("delete readme");
        let deleted = get_file_diff(path, "README.md").expect("deleted diff");
        assert_eq!(deleted.old_content, "initial\n");
        assert_eq!(deleted.new_content, "");
        assert!(!deleted.is_new);
        assert!(deleted.is_deleted);

        std::fs::write(path.join("binary.bin"), b"a\0b").expect("write binary file");
        let binary = get_file_diff(path, "binary.bin").expect("binary diff");
        assert!(binary.is_binary);
        assert_eq!(binary.file_path, "binary.bin");
    }

    #[serial]
    #[test]
    fn get_git_diff_errors_when_clean_and_summarizes_local_changes() {
        let repo = make_test_repo();
        let path = repo.path();
        assert_eq!(
            get_git_diff(path).unwrap_err(),
            "No changes to commit".to_string()
        );

        std::fs::write(path.join("README.md"), "changed\n").expect("modify readme");
        std::fs::write(path.join("new.txt"), "new\n").expect("write new file");

        let diff = get_git_diff(path).expect("get git diff");

        assert!(diff.contains("Unstaged changes:"), "{diff}");
        assert!(diff.contains("README.md"), "{diff}");
        assert!(diff.contains("New files:"), "{diff}");
        assert!(diff.contains("new.txt"), "{diff}");
        assert!(diff.contains("Diff:"), "{diff}");
    }

    #[serial]
    #[test]
    fn get_branch_diff_stats_counts_local_ahead_and_changed_files() {
        let repo = make_test_repo();
        let path = repo.path();
        std::fs::write(path.join("README.md"), "changed\n").expect("modify readme");

        let stats = get_branch_diff_stats(path, "main", Some("test"));

        assert_eq!(stats.ahead, 1);
        assert_eq!(stats.behind, 0);
        assert_eq!(stats.changed_files, 1);
        assert_eq!(stats.unpushed_commits, 1);
        assert_eq!(stats.ahead_of_test, 1);
    }

    #[serial]
    #[test]
    fn sync_with_base_branch_uses_local_origin_and_reports_success() {
        let repo = make_test_repo();

        let message = sync_with_base_branch(repo.path(), "main").expect("sync with main");

        assert_eq!(message, "Successfully synced with main");
        assert_eq!(
            git_output(repo.path(), &["branch", "--show-current"]),
            "feature/demo"
        );
    }

    #[serial]
    #[test]
    fn merge_to_test_branch_merges_locally_pushes_to_local_origin_and_restores_branch() {
        let repo = make_test_repo();
        let path = repo.path();

        let result = merge_to_test_branch(path, "test").expect("merge to test branch");

        assert!(
            result.contains("成功将 feature/demo 合并到 test"),
            "{result}"
        );
        assert!(
            result.contains("✓ 本地 test 分支已同步到 origin/test"),
            "{result}"
        );
        assert!(!result.contains("⚠"), "{result}");
        assert_eq!(
            git_output(path, &["branch", "--show-current"]),
            "feature/demo"
        );
        run_git(
            path,
            &["merge-base", "--is-ancestor", "feature/demo", "origin/test"],
        );
        // The bare origin really received the merge result.
        let remote_test = git_output(path, &["ls-remote", "origin", "refs/heads/test"]);
        assert!(
            remote_test.starts_with(&git_output(path, &["rev-parse", "origin/test"])),
            "{remote_test}"
        );
        // The idle local test branch (checked out nowhere) was fast-forwarded to origin/test.
        assert_eq!(
            git_output(path, &["rev-parse", "test"]),
            git_output(path, &["rev-parse", "origin/test"])
        );
        // No leftover merge state, no detached HEAD.
        assert_eq!(git_output(path, &["status", "--porcelain"]), "");
    }

    #[serial]
    #[test]
    fn merge_to_base_branch_reports_missing_remote_branch_for_nonexistent_target() {
        let repo = make_test_repo();

        let err = merge_to_base_branch(repo.path(), "does-not-exist").unwrap_err();

        assert_eq!(err, "远程分支 origin/does-not-exist 不存在");
        assert_eq!(
            git_output(repo.path(), &["branch", "--show-current"]),
            "feature/demo"
        );
        assert_eq!(git_output(repo.path(), &["status", "--porcelain"]), "");
    }

    #[serial]
    #[test]
    fn push_pull_fetch_and_remote_branch_listing_use_local_bare_origin() {
        let repo = make_test_repo();
        let path = repo.path();

        let push = push_to_remote(path).expect("push current branch");
        assert_eq!(push, "Successfully pushed feature/demo to origin");
        assert!(check_remote_branch_exists(path, "feature/demo").expect("feature remote exists"));

        let origin_url = git_output(path, &["remote", "get-url", "origin"]);
        let upstream = tempfile::tempdir().expect("create upstream clone dir");
        clone_repo(Path::new(&origin_url), upstream.path());
        run_git(
            upstream.path(),
            &["config", "user.email", "upstream@example.com"],
        );
        run_git(upstream.path(), &["config", "user.name", "Upstream User"]);
        run_git(upstream.path(), &["checkout", "feature/demo"]);
        std::fs::write(upstream.path().join("upstream.txt"), "upstream\n")
            .expect("write upstream file");
        run_git(upstream.path(), &["add", "upstream.txt"]);
        run_git(upstream.path(), &["commit", "-m", "upstream commit"]);
        run_git(upstream.path(), &["push", "origin", "feature/demo"]);

        let pull = pull_current_branch(path).expect("pull current branch");
        assert_eq!(pull, "Successfully pulled feature/demo from origin");
        assert_eq!(
            std::fs::read_to_string(path.join("upstream.txt")).expect("read pulled file"),
            "upstream\n"
        );

        fetch_remote(path).expect("fetch remote");
        let branches = get_remote_branches(path).expect("get remote branches");
        assert!(branches.contains(&"main".to_string()), "{branches:?}");
        assert!(branches.contains(&"test".to_string()), "{branches:?}");
        assert!(
            branches.contains(&"feature/demo".to_string()),
            "{branches:?}"
        );
    }

    #[serial]
    #[test]
    fn sync_with_base_branch_reports_merge_conflict_from_local_origin() {
        let repo = make_test_repo();
        let path = repo.path();

        std::fs::write(path.join("README.md"), "feature side\n").expect("write feature readme");
        run_git(path, &["add", "README.md"]);
        run_git(path, &["commit", "-m", "feature readme change"]);
        run_git(path, &["checkout", "main"]);
        std::fs::write(path.join("README.md"), "main side\n").expect("write main readme");
        run_git(path, &["add", "README.md"]);
        run_git(path, &["commit", "-m", "main readme change"]);
        run_git(path, &["push", "origin", "main"]);
        run_git(path, &["checkout", "feature/demo"]);

        let err = sync_with_base_branch(path, "main").unwrap_err();

        assert!(err.contains("Git merge failed"), "{err}");
        let status = git_output(path, &["status", "--porcelain"]);
        assert!(status.contains("UU README.md"), "{status}");
        run_git(path, &["merge", "--abort"]);
    }

    #[serial]
    #[test]
    fn merge_to_base_branch_merges_pushes_and_restores_feature_branch() {
        let repo = make_test_repo();
        let path = repo.path();

        let result = merge_to_base_branch(path, "main").expect("merge to base");

        assert!(
            result.contains("成功将 feature/demo 合并到 main"),
            "{result}"
        );
        assert!(
            result.contains("✓ 本地 main 分支已同步到 origin/main"),
            "{result}"
        );
        assert_eq!(
            git_output(path, &["branch", "--show-current"]),
            "feature/demo"
        );
        run_git(path, &["fetch", "origin"]);
        run_git(
            path,
            &["merge-base", "--is-ancestor", "feature/demo", "origin/main"],
        );
        assert_eq!(
            git_output(path, &["rev-parse", "main"]),
            git_output(path, &["rev-parse", "origin/main"])
        );
    }

    #[serial]
    #[test]
    fn merge_to_test_branch_aborts_conflict_and_restores_original_branch() {
        let repo = make_test_repo();
        let path = repo.path();

        std::fs::write(path.join("README.md"), "feature side\n").expect("write feature readme");
        run_git(path, &["add", "README.md"]);
        run_git(path, &["commit", "-m", "feature readme change"]);
        run_git(path, &["checkout", "test"]);
        std::fs::write(path.join("README.md"), "test side\n").expect("write test readme");
        run_git(path, &["add", "README.md"]);
        run_git(path, &["commit", "-m", "test readme change"]);
        run_git(path, &["push", "origin", "test"]);
        run_git(path, &["checkout", "feature/demo"]);

        let err = merge_to_test_branch(path, "test").unwrap_err();

        assert!(err.contains("合并 feature/demo 到 test 失败"), "{err}");
        assert_eq!(
            git_output(path, &["branch", "--show-current"]),
            "feature/demo"
        );
        assert_eq!(git_output(path, &["status", "--porcelain"]), "");
    }

    #[serial]
    #[test]
    fn get_changed_files_parses_rename_staged_modified_and_unstaged_delete() {
        let repo = make_test_repo();
        let path = repo.path();

        std::fs::write(path.join("delete-me.txt"), "delete me\n").expect("write tracked file");
        run_git(path, &["add", "delete-me.txt"]);
        run_git(path, &["commit", "-m", "add delete target"]);
        run_git(path, &["mv", "README.md", "RENAMED.md"]);
        std::fs::write(path.join("feature.txt"), "feature changed\n")
            .expect("modify tracked feature");
        run_git(path, &["add", "feature.txt"]);
        std::fs::remove_file(path.join("delete-me.txt")).expect("delete tracked file");

        let files = get_changed_files(path).expect("get changed files");

        let renamed = changed_file(&files, "RENAMED.md");
        assert_eq!(renamed.status, "R");
        assert!(renamed.staged);

        let modified = changed_file(&files, "feature.txt");
        assert_eq!(modified.status, "M");
        assert!(modified.staged);

        let deleted = changed_file(&files, "delete-me.txt");
        assert_eq!(deleted.status, "D");
        assert!(!deleted.staged);
    }

    #[serial]
    #[test]
    fn branch_diff_stats_handles_non_git_empty_test_branch_and_missing_refs() {
        let non_git = tempfile::tempdir().expect("create non git dir");
        let empty = get_branch_diff_stats(non_git.path(), "main", Some("test"));
        assert_eq!(empty.ahead, 0);
        assert_eq!(empty.behind, 0);
        assert_eq!(empty.changed_files, 0);
        assert_eq!(empty.unpushed_commits, 0);
        assert_eq!(empty.ahead_of_test, 0);

        let repo = make_test_repo();
        let no_test = get_branch_diff_stats(repo.path(), "main", Some(""));
        assert_eq!(no_test.ahead, 1);
        assert_eq!(no_test.ahead_of_test, 0);

        let missing_test = get_branch_diff_stats(repo.path(), "main", Some("missing-test"));
        assert_eq!(missing_test.ahead, 1);
        assert_eq!(missing_test.ahead_of_test, 0);
    }

    #[serial]
    #[test]
    fn remote_url_platform_detection_and_pr_unknown_platform_are_pure_local_logic() {
        let repo = make_test_repo();
        let path = repo.path();

        assert_eq!(
            remote_url_to_web_url("git@github.com:owner/repo.git").as_deref(),
            Some("https://github.com/owner/repo")
        );
        assert_eq!(
            remote_url_to_web_url("https://gitlab.com/group/repo.git").as_deref(),
            Some("https://gitlab.com/group/repo")
        );
        assert!(remote_url_to_web_url("/tmp/local.git").is_none());

        run_git(
            path,
            &[
                "remote",
                "set-url",
                "origin",
                "git@github.com:owner/repo.git",
            ],
        );
        assert_eq!(
            detect_git_platform(path).expect("detect github"),
            GitPlatform::GitHub
        );

        run_git(
            path,
            &[
                "remote",
                "set-url",
                "origin",
                "git@gitlab.com:group/repo.git",
            ],
        );
        assert_eq!(
            detect_git_platform(path).expect("detect gitlab"),
            GitPlatform::GitLab
        );

        run_git(path, &["remote", "set-url", "origin", "/tmp/local.git"]);
        assert_eq!(
            detect_git_platform(path).expect("detect unknown"),
            GitPlatform::Unknown
        );
        let err = create_pull_request(path, "main", "Title", "Body").unwrap_err();
        assert_eq!(
            err,
            "Unknown git platform. Only GitHub and GitLab are supported."
        );
    }

    #[serial]
    #[test]
    fn detached_head_paths_report_head_boundary_conditions() {
        let repo = make_test_repo();
        let path = repo.path();
        let head = git_output(path, &["rev-parse", "HEAD"]);
        run_git(path, &["checkout", "--detach", &head]);

        assert_eq!(
            get_current_branch_inner(path).expect("read detached branch"),
            "HEAD"
        );
        let info = get_worktree_info_for_branches(path, "main", "test");
        assert_eq!(info.current_branch, "HEAD");

        let err = merge_to_test_branch(path, "test").unwrap_err();
        assert!(err.contains("detached"), "{err}");
        // Nothing was touched: still detached at the same commit, origin/test unchanged.
        assert_eq!(
            git_output(path, &["rev-parse", "--abbrev-ref", "HEAD"]),
            "HEAD"
        );
        assert_eq!(git_output(path, &["rev-parse", "HEAD"]), head);
        let ancestor = Command::new("git")
            .args(["merge-base", "--is-ancestor", &head, "origin/test"])
            .current_dir(path)
            .status()
            .expect("check detached commit ancestry");
        assert!(
            !ancestor.success(),
            "detached commit must not have been merged into origin/test"
        );
    }

    #[serial]
    #[test]
    fn branch_status_detects_merge_request_ref_matching_head_commit() {
        let repo = make_test_repo();
        let path = repo.path();
        run_git(path, &["update-ref", "refs/pull/7/head", "HEAD"]);

        let status = get_branch_status(path, "demo", "main");

        assert_eq!(status.branch_name, "feature/demo");
        assert!(status.has_merge_request, "{status:?}");
    }

    #[serial]
    #[test]
    fn git_command_error_paths_report_specific_failures() {
        let non_git = tempfile::tempdir().expect("create non-git dir");

        let sync_err = sync_with_base_branch(non_git.path(), "main").unwrap_err();
        assert!(sync_err.contains("Git fetch failed"), "{sync_err}");

        let push_err = push_to_remote(non_git.path()).unwrap_err();
        assert_eq!(push_err, "Failed to get current branch");

        let pull_err = pull_current_branch(non_git.path()).unwrap_err();
        assert_eq!(pull_err, "Failed to get current branch");

        let fetch_err = fetch_remote(non_git.path()).unwrap_err();
        assert!(fetch_err.contains("Git fetch failed"), "{fetch_err}");

        let branches_err = get_remote_branches(non_git.path()).unwrap_err();
        assert!(branches_err.contains("Git fetch failed"), "{branches_err}");
    }

    #[serial]
    #[test]
    fn create_pull_request_returns_browser_urls_or_errors_without_network_success() {
        let repo = make_test_repo();
        let path = repo.path();

        run_git(
            path,
            &[
                "remote",
                "set-url",
                "origin",
                "git@github.com:owner/repo.git",
            ],
        );
        let github = create_pull_request(path, "main", "Feature title", "Body text")
            .expect("github should return browser fallback when gh cannot create PR");
        assert!(
            github == "https://github.com/owner/repo/pull/new/feature/demo"
                || github
                    .starts_with("https://github.com/owner/repo/compare/main...feature%2Fdemo?"),
            "{github}"
        );

        let gitlab_origin = path.join(".git").join("gitlab-origin.git");
        let output = Command::new("git")
            .args(["init", "--bare"])
            .arg(&gitlab_origin)
            .output()
            .expect("init gitlab-named bare origin");
        assert!(
            output.status.success(),
            "git init --bare failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        run_git(
            path,
            &[
                "remote",
                "set-url",
                "origin",
                gitlab_origin.to_str().unwrap(),
            ],
        );
        let gitlab = create_pull_request(path, "main", "Feature title", "Body text").unwrap_err();
        assert!(gitlab.contains("Failed to create MR"), "{gitlab}");
    }

    #[serial]
    #[test]
    fn binary_file_diff_detects_binary_content_stored_in_head() {
        let repo = make_test_repo();
        let path = repo.path();
        std::fs::write(path.join("tracked.bin"), b"old\0binary").expect("write binary file");
        run_git(path, &["add", "tracked.bin"]);
        run_git(path, &["commit", "-m", "add binary"]);

        let diff = get_file_diff(path, "tracked.bin").expect("binary diff from HEAD");

        assert_eq!(diff.file_path, "tracked.bin");
        assert!(diff.is_binary);
        assert!(!diff.is_new);
        assert!(!diff.is_deleted);
        assert!(diff.old_content.is_empty());
        assert!(diff.new_content.is_empty());
    }

    #[serial]
    #[test]
    fn commit_all_applies_author_override_and_user_config_round_trips() {
        let repo = make_test_repo();
        let path = repo.path();

        set_git_user_config(path, Some("Local Name"), Some("local@example.com"))
            .expect("set local git user config");
        let (name, email) = get_git_user_config(path).expect("get local git user config");
        assert_eq!(name.as_deref(), Some("Local Name"));
        assert_eq!(email.as_deref(), Some("local@example.com"));

        std::fs::write(path.join("author.txt"), "authored\n").expect("write authored file");
        let message = commit_all(
            path,
            "author override commit",
            Some("Override Name"),
            Some("override@example.com"),
            false,
        )
        .expect("commit with author override");

        assert_eq!(message, "Committed: author override commit");
        assert_eq!(
            git_output(path, &["log", "-1", "--format=%an <%ae>"]),
            "Override Name <override@example.com>"
        );
    }

    /// Second clone of the repo's bare origin, with its own identity, checked out on `branch`.
    fn clone_origin_on_branch(repo: &Path, branch: &str) -> TempDir {
        let origin_url = git_output(repo, &["remote", "get-url", "origin"]);
        let other = tempfile::tempdir().expect("create second clone dir");
        clone_repo(Path::new(&origin_url), other.path());
        run_git(other.path(), &["config", "user.email", "other@example.com"]);
        run_git(other.path(), &["config", "user.name", "Other User"]);
        run_git(other.path(), &["checkout", branch]);
        other
    }

    fn commit_file(repo: &Path, name: &str, content: &str, message: &str) -> String {
        std::fs::write(repo.join(name), content).expect("write file to commit");
        run_git(repo, &["add", name]);
        run_git(repo, &["commit", "-m", message]);
        git_output(repo, &["rev-parse", "HEAD"])
    }

    fn is_ancestor(repo: &Path, ancestor: &str, descendant: &str) -> bool {
        Command::new("git")
            .args(["merge-base", "--is-ancestor", ancestor, descendant])
            .current_dir(repo)
            .status()
            .expect("run git merge-base --is-ancestor")
            .success()
    }

    fn remote_head_of(repo: &Path, branch: &str) -> String {
        let line = git_output(
            repo,
            &["ls-remote", "origin", &format!("refs/heads/{branch}")],
        );
        line.split_whitespace()
            .next()
            .unwrap_or_else(|| panic!("origin has no {branch}: {line:?}"))
            .to_string()
    }

    #[serial]
    #[test]
    fn merge_to_test_branch_succeeds_when_local_test_has_diverged_from_origin() {
        let repo = make_test_repo();
        let path = repo.path();

        // A local-only commit on test (e.g. left behind by an earlier failed push).
        run_git(path, &["checkout", "test"]);
        let local_only = commit_file(path, "local-only.txt", "local\n", "local-only test commit");
        run_git(path, &["checkout", "feature/demo"]);

        // Meanwhile origin/test moved on with a different commit: local test has diverged.
        let other = clone_origin_on_branch(path, "test");
        let origin_side = commit_file(
            other.path(),
            "origin-side.txt",
            "origin\n",
            "origin-side test commit",
        );
        run_git(other.path(), &["push", "origin", "test"]);

        let result =
            merge_to_test_branch(path, "test").expect("merge must not care about local test");

        assert!(
            result.contains("成功将 feature/demo 合并到 test"),
            "{result}"
        );
        assert!(
            result.contains("⚠ 本地 test 含有未推送的提交，已保留未动"),
            "{result}"
        );
        assert_eq!(
            git_output(path, &["branch", "--show-current"]),
            "feature/demo"
        );
        assert_eq!(git_output(path, &["status", "--porcelain"]), "");

        // origin/test = origin's commit + the feature commit, WITHOUT the local-only commit.
        assert_eq!(
            remote_head_of(path, "test"),
            git_output(path, &["rev-parse", "origin/test"])
        );
        assert!(is_ancestor(path, &origin_side, "origin/test"));
        assert!(is_ancestor(path, "feature/demo", "origin/test"));
        assert!(!is_ancestor(path, &local_only, "origin/test"));

        // Local test was left exactly where it was.
        assert_eq!(git_output(path, &["rev-parse", "test"]), local_only);
    }

    #[serial]
    #[test]
    fn merge_to_test_branch_fast_forwards_clean_main_worktree_that_has_test_checked_out() {
        let repo = make_test_repo();
        let main = repo.path();
        run_git(main, &["checkout", "test"]);
        let linked_parent = tempfile::tempdir().expect("create linked worktree parent");
        let linked = linked_parent.path().join("feature-wt");
        run_git(
            main,
            &["worktree", "add", linked.to_str().unwrap(), "feature/demo"],
        );
        let main_before = git_output(main, &["rev-parse", "HEAD"]);

        let result = merge_to_test_branch(&linked, "test").expect("merge from linked worktree");

        assert!(
            result.contains("成功将 feature/demo 合并到 test"),
            "{result}"
        );
        assert!(result.contains("上的 test 已快进到最新"), "{result}");
        assert!(!result.contains("⚠"), "{result}");

        // Main stays on test (never detached) and now points at the pushed merge result.
        assert_eq!(git_output(main, &["branch", "--show-current"]), "test");
        assert_ne!(git_output(main, &["rev-parse", "HEAD"]), main_before);
        assert_eq!(
            git_output(main, &["rev-parse", "HEAD"]),
            git_output(main, &["rev-parse", "origin/test"])
        );
        assert_eq!(
            remote_head_of(main, "test"),
            git_output(main, &["rev-parse", "test"])
        );
        assert!(is_ancestor(main, "feature/demo", "test"));
        assert!(main.join("feature.txt").exists());
        assert_eq!(git_output(main, &["status", "--porcelain"]), "");

        // The feature worktree is back on its own branch.
        assert_eq!(
            git_output(&linked, &["branch", "--show-current"]),
            "feature/demo"
        );
        assert_eq!(git_output(&linked, &["status", "--porcelain"]), "");
    }

    #[serial]
    #[test]
    fn merge_to_test_branch_warns_but_succeeds_when_dirty_linked_worktree_holds_test() {
        let repo = make_test_repo();
        let main = repo.path(); // on feature/demo
        let linked_parent = tempfile::tempdir().expect("create linked worktree parent");
        let linked = linked_parent.path().join("test-wt");
        run_git(main, &["worktree", "add", linked.to_str().unwrap(), "test"]);
        std::fs::write(linked.join("README.md"), "dirty in test worktree\n")
            .expect("dirty a tracked file in the test worktree");
        let linked_before = git_output(&linked, &["rev-parse", "HEAD"]);

        let result = merge_to_test_branch(main, "test")
            .expect("another worktree holding test must not block the merge");

        assert!(
            result.contains("成功将 feature/demo 合并到 test"),
            "{result}"
        );
        assert!(result.contains("⚠"), "{result}");
        assert!(result.contains("本地 test 未更新"), "{result}");
        assert_eq!(
            git_output(main, &["branch", "--show-current"]),
            "feature/demo"
        );
        assert!(is_ancestor(main, "feature/demo", "origin/test"));
        assert_eq!(
            remote_head_of(main, "test"),
            git_output(main, &["rev-parse", "origin/test"])
        );

        // The dirty worktree was left alone: same branch, same commit, same uncommitted change.
        assert_eq!(git_output(&linked, &["branch", "--show-current"]), "test");
        assert_eq!(git_output(&linked, &["rev-parse", "HEAD"]), linked_before);
        assert_eq!(
            std::fs::read_to_string(linked.join("README.md")).expect("read dirty file"),
            "dirty in test worktree\n"
        );
    }

    #[serial]
    #[test]
    fn merge_to_test_branch_from_test_itself_syncs_local_test_and_stays_on_it() {
        let repo = make_test_repo();
        let path = repo.path();
        run_git(path, &["checkout", "test"]);
        let other = clone_origin_on_branch(path, "test");
        let origin_side = commit_file(
            other.path(),
            "origin-side.txt",
            "origin\n",
            "origin-side test commit",
        );
        run_git(other.path(), &["push", "origin", "test"]);

        let result = merge_to_test_branch(path, "test").expect("merge test into itself");

        assert!(result.contains("成功将 test 合并到 test"), "{result}");
        assert!(
            result.contains("✓ 本地 test 分支已同步到 origin/test"),
            "{result}"
        );
        assert_eq!(git_output(path, &["branch", "--show-current"]), "test");
        assert_eq!(git_output(path, &["rev-parse", "HEAD"]), origin_side);
        assert!(path.join("origin-side.txt").exists());
    }

    #[serial]
    #[test]
    fn merge_to_test_branch_rejects_uncommitted_tracked_changes_but_ignores_untracked_files() {
        let repo = make_test_repo();
        let path = repo.path();
        std::fs::write(path.join("feature.txt"), "work in progress\n")
            .expect("modify tracked file");

        let err = merge_to_test_branch(path, "test").unwrap_err();

        assert!(err.contains("未提交"), "{err}");
        assert!(err.contains("test"), "{err}");
        assert_eq!(
            git_output(path, &["branch", "--show-current"]),
            "feature/demo"
        );
        assert_eq!(
            std::fs::read_to_string(path.join("feature.txt")).expect("read modified file"),
            "work in progress\n"
        );
        assert!(!is_ancestor(path, "feature/demo", "origin/test"));

        // Untracked files are not a reason to refuse.
        run_git(path, &["checkout", "--", "feature.txt"]);
        std::fs::write(path.join("scratch.txt"), "untracked\n").expect("write untracked file");
        let result =
            merge_to_test_branch(path, "test").expect("untracked files do not block the merge");
        assert!(
            result.contains("成功将 feature/demo 合并到 test"),
            "{result}"
        );
        assert!(path.join("scratch.txt").exists());
        assert_eq!(
            git_output(path, &["branch", "--show-current"]),
            "feature/demo"
        );
    }

    #[serial]
    #[test]
    fn merge_to_test_branch_restores_feature_branch_when_fetch_fails() {
        let repo = make_test_repo();
        let path = repo.path();
        let broken_origin = path.join(".git").join("missing-origin.git");
        run_git(
            path,
            &[
                "remote",
                "set-url",
                "origin",
                broken_origin.to_str().unwrap(),
            ],
        );

        let err = merge_to_test_branch(path, "test").unwrap_err();

        assert!(err.contains("拉取 test 最新代码失败"), "{err}");
        assert!(!err.contains("切回"), "{err}");
        assert_eq!(
            git_output(path, &["branch", "--show-current"]),
            "feature/demo"
        );
        assert_eq!(git_output(path, &["status", "--porcelain"]), "");
    }

    #[serial]
    #[test]
    fn pull_current_branch_merges_diverged_remote_and_reports_missing_remote_branch() {
        let repo = make_test_repo();
        let path = repo.path();
        run_git(path, &["push", "origin", "feature/demo"]);

        let other = clone_origin_on_branch(path, "feature/demo");
        let remote_side = commit_file(
            other.path(),
            "remote-side.txt",
            "remote\n",
            "remote side commit",
        );
        run_git(other.path(), &["push", "origin", "feature/demo"]);
        let local_side = commit_file(path, "local-side.txt", "local\n", "local side commit");

        let message = pull_current_branch(path).expect("pull merges the diverged remote branch");

        assert_eq!(message, "Successfully pulled feature/demo from origin");
        let parents = git_output(path, &["rev-list", "--parents", "-n", "1", "HEAD"]);
        assert_eq!(
            parents.split_whitespace().count(),
            3,
            "expected a merge commit, got {parents}"
        );
        assert!(is_ancestor(path, &remote_side, "HEAD"));
        assert!(is_ancestor(path, &local_side, "HEAD"));
        assert!(path.join("remote-side.txt").exists());
        assert!(path.join("local-side.txt").exists());
        assert_eq!(git_output(path, &["status", "--porcelain"]), "");

        run_git(path, &["checkout", "-b", "feature/never-pushed"]);
        let err = pull_current_branch(path).unwrap_err();
        assert_eq!(err, "远程 origin 不存在分支 feature/never-pushed，无法拉取");
    }
}
