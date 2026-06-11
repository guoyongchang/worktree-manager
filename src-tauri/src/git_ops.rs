use git2::{Repository, StatusOptions};
use serde::Serialize;
use std::path::Path;

use crate::utils::{git_command, run_git_logged};

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

/// Helper function to find the main worktree path for a given repository
fn find_main_worktree(repo_path: &Path) -> Option<std::path::PathBuf> {
    let git_path = repo_path.join(".git");
    if git_path.is_dir() {
        log::debug!(
            "[merge] repo_path={} is the main worktree itself",
            repo_path.display()
        );
        return Some(repo_path.to_path_buf());
    } else if git_path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&git_path) {
            if let Some(gitdir) = content.strip_prefix("gitdir: ") {
                let gitdir = gitdir.trim();
                let worktrees_idx_opt = gitdir
                    .find("/.git/worktrees/")
                    .or_else(|| gitdir.find("\\.git\\worktrees\\"));
                if let Some(worktrees_idx) = worktrees_idx_opt {
                    let main_path = &gitdir[..worktrees_idx];
                    log::debug!(
                        "[merge] Linked worktree detected. Main worktree: {}",
                        main_path
                    );
                    return Some(std::path::PathBuf::from(main_path));
                }
            }
        }
    }
    log::debug!(
        "[merge] Could not find main worktree for {}",
        repo_path.display()
    );
    None
}

/// Check if a branch is checked out in the main worktree and switch to detached HEAD if needed
/// Returns (switched, original_branch) - switched=true if we switched to detached HEAD
fn handle_branch_checkout_conflict(
    main_worktree_path: &Path,
    target_branch: &str,
) -> Result<(bool, Option<String>), String> {
    log::info!(
        "[merge] Checking branch conflict: target_branch={}, main_worktree={}",
        target_branch,
        main_worktree_path.display()
    );

    let repo = Repository::open(main_worktree_path).map_err(|e| {
        format!(
            "无法打开主工作区仓库 ({}): {}",
            main_worktree_path.display(),
            e
        )
    })?;

    if let Ok(head) = repo.head() {
        let current_branch = head.shorthand().unwrap_or("<detached>");
        log::info!(
            "[merge] Main worktree current branch: {}, target: {}",
            current_branch,
            target_branch
        );

        if current_branch == target_branch {
            log::info!("[merge] Branch conflict detected! Checking uncommitted changes...");

            let status_output = git_command()
                .arg("-C")
                .arg(main_worktree_path)
                .arg("status")
                .arg("--porcelain")
                .output()
                .map_err(|e| format!("检查主工作区 git status 失败: {}", e))?;

            let status_str = String::from_utf8_lossy(&status_output.stdout);
            let has_changes = !status_str.is_empty();

            if has_changes {
                log::warn!(
                    "[merge] Main worktree has uncommitted changes:\n{}",
                    status_str.trim()
                );
                return Err(format!(
                    "主工作区的 {} 分支有未提交的更改，无法自动切换。\n\
                    请先在主工作区提交或撤销更改后再试。\n\
                    未提交的文件: {}",
                    target_branch,
                    status_str.trim()
                ));
            }

            let head_commit = head
                .peel_to_commit()
                .map_err(|e| format!("获取 HEAD commit 失败: {}", e))?;
            let commit_sha = head_commit.id().to_string();

            log::info!(
                "[merge] Main worktree is clean. Switching to detached HEAD at {}",
                &commit_sha[..8]
            );

            let mut checkout_cmd = git_command();
            checkout_cmd
                .arg("-C")
                .arg(main_worktree_path)
                .arg("checkout")
                .arg("--detach")
                .arg(&commit_sha);
            let checkout_output = run_git_logged(&mut checkout_cmd, "merge checkout detach")
                .map_err(|e| format!("执行 git checkout --detach 失败: {}", e))?;

            if !checkout_output.status.success() {
                let stderr = String::from_utf8_lossy(&checkout_output.stderr);
                log::error!("[merge] Failed to detach HEAD: {}", stderr);
                return Err(format!("无法将主工作区切换到 detached HEAD: {}", stderr));
            }

            log::info!("[merge] Successfully switched main worktree to detached HEAD");
            return Ok((true, Some(target_branch.to_string())));
        } else {
            log::info!(
                "[merge] No branch conflict (main={}, target={})",
                current_branch,
                target_branch
            );
        }
    } else {
        log::warn!("[merge] Cannot read HEAD of main worktree, skipping conflict check");
    }

    Ok((false, None))
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
    log::info!("[git] Step 2/2: git merge origin/{}", base_branch);
    let mut merge_cmd = git_command();
    merge_cmd
        .arg("-C")
        .arg(path)
        .arg("merge")
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

/// Pull current branch from remote (git pull origin <current_branch>)
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

    // Step 2: Pull from origin
    log::info!("[git] Pulling branch '{}' from origin", current_branch);
    let mut pull_cmd = git_command();
    pull_cmd
        .arg("-C")
        .arg(path)
        .arg("pull")
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
        return Err(format!("Git pull failed: {}", stderr));
    }

    log::info!("[git] Successfully pulled '{}' from origin", current_branch);
    Ok(format!(
        "Successfully pulled {} from origin",
        current_branch
    ))
}

/// Helper to restore main worktree and checkout back to original branch on error/cleanup
fn restore_merge_state(
    path: &Path,
    original_branch: &str,
    switched_main: bool,
    main_worktree_path: &Option<std::path::PathBuf>,
    original_main_branch: &Option<String>,
) {
    // Checkout back to original branch in worktree
    log::info!("[merge] Restoring worktree to branch: {}", original_branch);
    let mut restore_cmd = git_command();
    restore_cmd
        .arg("-C")
        .arg(path)
        .arg("checkout")
        .arg(original_branch);
    let restore = run_git_logged(&mut restore_cmd, "merge restore worktree checkout");
    match &restore {
        Ok(output) if output.status.success() => {
            log::info!("[merge] Restored worktree to {}", original_branch);
        }
        Ok(output) => {
            log::error!(
                "[merge] Failed to restore worktree to {}: {}",
                original_branch,
                String::from_utf8_lossy(&output.stderr)
            );
        }
        Err(e) => {
            log::error!("[merge] Failed to execute git checkout for restore: {}", e);
        }
    }

    // Restore main worktree if we switched it
    if switched_main {
        if let (Some(main_wt), Some(orig_branch)) = (main_worktree_path, original_main_branch) {
            log::info!("[merge] Restoring main worktree to branch: {}", orig_branch);
            let mut restore_cmd = git_command();
            restore_cmd
                .arg("-C")
                .arg(main_wt)
                .arg("checkout")
                .arg(orig_branch);
            let restore_output =
                run_git_logged(&mut restore_cmd, "merge restore main worktree checkout");
            match &restore_output {
                Ok(output) if output.status.success() => {
                    log::info!("[merge] Restored main worktree to {}", orig_branch);
                }
                Ok(output) => {
                    log::error!(
                        "[merge] Failed to restore main worktree to {}: {}",
                        orig_branch,
                        String::from_utf8_lossy(&output.stderr)
                    );
                }
                Err(e) => {
                    log::error!(
                        "[merge] Failed to execute git checkout for main restore: {}",
                        e
                    );
                }
            }
        }
    }
}

/// Merge current branch to test branch
pub fn merge_to_test_branch(path: &Path, test_branch: &str) -> Result<String, String> {
    log::info!("[merge-test] ===== START merge_to_test_branch =====");
    log::info!(
        "[merge-test] path={}, test_branch={}",
        path.display(),
        test_branch
    );

    let repo =
        Repository::open(path).map_err(|e| format!("无法打开仓库 ({}): {}", path.display(), e))?;

    let head = repo
        .head()
        .map_err(|e| format!("无法读取 HEAD ({}): {}", path.display(), e))?;
    let current_branch = head
        .shorthand()
        .ok_or_else(|| "无法获取当前分支名 (HEAD 可能处于 detached 状态)".to_string())?;

    log::info!("[merge-test] current_branch={}", current_branch);

    // Find main worktree and handle potential checkout conflict
    let mut main_worktree_path: Option<std::path::PathBuf> = None;
    let mut switched_main = false;
    let mut original_main_branch: Option<String> = None;

    if let Some(main_wt) = find_main_worktree(path) {
        main_worktree_path = Some(main_wt.clone());
        log::info!("[merge-test] Step 1: Handling branch checkout conflict...");
        let (switched, orig_branch) = handle_branch_checkout_conflict(&main_wt, test_branch)?;
        switched_main = switched;
        original_main_branch = orig_branch;
        log::info!("[merge-test] Step 1 done: switched_main={}", switched_main);
    } else {
        log::info!("[merge-test] Step 1: No main worktree found, skipping conflict check");
    }

    // Step 2: Checkout test branch
    log::info!("[merge-test] Step 2: git checkout {}", test_branch);
    let mut checkout_cmd = git_command();
    checkout_cmd
        .arg("-C")
        .arg(path)
        .arg("checkout")
        .arg(test_branch);
    let checkout_output = run_git_logged(&mut checkout_cmd, "merge-test checkout target")
        .map_err(|e| format!("执行 git checkout {} 失败: {}", test_branch, e))?;

    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        log::error!(
            "[merge-test] Step 2 FAILED: checkout {} => {}",
            test_branch,
            stderr
        );
        if switched_main {
            restore_merge_state(
                path,
                current_branch,
                switched_main,
                &main_worktree_path,
                &original_main_branch,
            );
        }
        return Err(format!("切换到 {} 分支失败: {}", test_branch, stderr));
    }
    log::info!("[merge-test] Step 2 OK: checked out {}", test_branch);

    // Step 3: Pull latest
    log::info!("[merge-test] Step 3: git pull origin {}", test_branch);
    let mut pull_cmd = git_command();
    pull_cmd
        .arg("-C")
        .arg(path)
        .arg("pull")
        .arg("origin")
        .arg(test_branch);
    let pull_output = run_git_logged(&mut pull_cmd, "merge-test pull target")
        .map_err(|e| format!("执行 git pull origin {} 失败: {}", test_branch, e))?;

    if !pull_output.status.success() {
        let stderr = String::from_utf8_lossy(&pull_output.stderr);
        log::error!("[merge-test] Step 3 FAILED: pull => {}", stderr);
        restore_merge_state(
            path,
            current_branch,
            switched_main,
            &main_worktree_path,
            &original_main_branch,
        );
        return Err(format!("拉取 {} 最新代码失败: {}", test_branch, stderr));
    }
    log::info!("[merge-test] Step 3 OK: pulled latest {}", test_branch);

    // Step 4: Merge
    log::info!("[merge-test] Step 4: git merge {}", current_branch);
    let mut merge_cmd = git_command();
    merge_cmd
        .arg("-C")
        .arg(path)
        .arg("merge")
        .arg(current_branch);
    let merge_output = run_git_logged(&mut merge_cmd, "merge-test merge current")
        .map_err(|e| format!("执行 git merge {} 失败: {}", current_branch, e))?;

    if !merge_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_output.stderr);
        let stdout = String::from_utf8_lossy(&merge_output.stdout);
        log::error!(
            "[merge-test] Step 4 FAILED: merge => stderr={}, stdout={}",
            stderr,
            stdout
        );
        // Abort merge if in conflict state
        let mut abort_cmd = git_command();
        abort_cmd.arg("-C").arg(path).arg("merge").arg("--abort");
        let _ = run_git_logged(&mut abort_cmd, "merge-test merge abort");
        restore_merge_state(
            path,
            current_branch,
            switched_main,
            &main_worktree_path,
            &original_main_branch,
        );
        return Err(format!(
            "合并 {} 到 {} 失败: {}{}",
            current_branch,
            test_branch,
            stderr,
            if !stdout.is_empty() {
                format!("\n{}", stdout)
            } else {
                String::new()
            }
        ));
    }
    log::info!(
        "[merge-test] Step 4 OK: merged {} into {}",
        current_branch,
        test_branch
    );

    // Step 5: Push
    log::info!("[merge-test] Step 5: git push origin {}", test_branch);
    let mut push_cmd = git_command();
    push_cmd
        .arg("-C")
        .arg(path)
        .arg("push")
        .arg("origin")
        .arg(test_branch)
        .arg("--no-verify");
    let push_output = run_git_logged(&mut push_cmd, "merge-test push target")
        .map_err(|e| format!("执行 git push origin {} 失败: {}", test_branch, e))?;

    let push_failed = !push_output.status.success();
    if push_failed {
        log::error!(
            "[merge-test] Step 5 FAILED: push => {}",
            String::from_utf8_lossy(&push_output.stderr)
        );
    } else {
        log::info!("[merge-test] Step 5 OK: pushed {}", test_branch);
    }

    // Step 6: Restore
    log::info!("[merge-test] Step 6: Restoring original state...");
    restore_merge_state(
        path,
        current_branch,
        switched_main,
        &main_worktree_path,
        &original_main_branch,
    );
    log::info!("[merge-test] Step 6 OK: Restored");

    if push_failed {
        return Err(format!(
            "推送 {} 到远程失败: {}",
            test_branch,
            String::from_utf8_lossy(&push_output.stderr)
        ));
    }

    let mut result = format!("成功将 {} 合并到 {}", current_branch, test_branch);
    if switched_main {
        result.push_str("\n\n✓ 主工作区已临时切换并已恢复");
    }

    log::info!("[merge-test] ===== DONE merge_to_test_branch =====");
    Ok(result)
}

/// Merge current branch to base branch
pub fn merge_to_base_branch(path: &Path, base_branch: &str) -> Result<String, String> {
    log::info!("[merge-base] ===== START merge_to_base_branch =====");
    log::info!(
        "[merge-base] path={}, base_branch={}",
        path.display(),
        base_branch
    );

    let repo =
        Repository::open(path).map_err(|e| format!("无法打开仓库 ({}): {}", path.display(), e))?;

    let head = repo
        .head()
        .map_err(|e| format!("无法读取 HEAD ({}): {}", path.display(), e))?;
    let current_branch = head
        .shorthand()
        .ok_or_else(|| "无法获取当前分支名 (HEAD 可能处于 detached 状态)".to_string())?;

    log::info!("[merge-base] current_branch={}", current_branch);

    // Find main worktree and handle potential checkout conflict
    let mut main_worktree_path: Option<std::path::PathBuf> = None;
    let mut switched_main = false;
    let mut original_main_branch: Option<String> = None;

    if let Some(main_wt) = find_main_worktree(path) {
        main_worktree_path = Some(main_wt.clone());
        log::info!("[merge-base] Step 1: Handling branch checkout conflict...");
        let (switched, orig_branch) = handle_branch_checkout_conflict(&main_wt, base_branch)?;
        switched_main = switched;
        original_main_branch = orig_branch;
        log::info!("[merge-base] Step 1 done: switched_main={}", switched_main);
    } else {
        log::info!("[merge-base] Step 1: No main worktree found, skipping conflict check");
    }

    // Step 2: Checkout base branch
    log::info!("[merge-base] Step 2: git checkout {}", base_branch);
    let mut checkout_cmd = git_command();
    checkout_cmd
        .arg("-C")
        .arg(path)
        .arg("checkout")
        .arg(base_branch);
    let checkout_output = run_git_logged(&mut checkout_cmd, "merge-base checkout target")
        .map_err(|e| format!("执行 git checkout {} 失败: {}", base_branch, e))?;

    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        log::error!(
            "[merge-base] Step 2 FAILED: checkout {} => {}",
            base_branch,
            stderr
        );
        if switched_main {
            restore_merge_state(
                path,
                current_branch,
                switched_main,
                &main_worktree_path,
                &original_main_branch,
            );
        }
        return Err(format!("切换到 {} 分支失败: {}", base_branch, stderr));
    }
    log::info!("[merge-base] Step 2 OK: checked out {}", base_branch);

    // Step 3: Pull latest
    log::info!("[merge-base] Step 3: git pull origin {}", base_branch);
    let mut pull_cmd = git_command();
    pull_cmd
        .arg("-C")
        .arg(path)
        .arg("pull")
        .arg("origin")
        .arg(base_branch);
    let pull_output = run_git_logged(&mut pull_cmd, "merge-base pull target")
        .map_err(|e| format!("执行 git pull origin {} 失败: {}", base_branch, e))?;

    if !pull_output.status.success() {
        let stderr = String::from_utf8_lossy(&pull_output.stderr);
        log::error!("[merge-base] Step 3 FAILED: pull => {}", stderr);
        restore_merge_state(
            path,
            current_branch,
            switched_main,
            &main_worktree_path,
            &original_main_branch,
        );
        return Err(format!("拉取 {} 最新代码失败: {}", base_branch, stderr));
    }
    log::info!("[merge-base] Step 3 OK: pulled latest {}", base_branch);

    // Step 4: Merge
    log::info!("[merge-base] Step 4: git merge {}", current_branch);
    let mut merge_cmd = git_command();
    merge_cmd
        .arg("-C")
        .arg(path)
        .arg("merge")
        .arg(current_branch);
    let merge_output = run_git_logged(&mut merge_cmd, "merge-base merge current")
        .map_err(|e| format!("执行 git merge {} 失败: {}", current_branch, e))?;

    if !merge_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_output.stderr);
        let stdout = String::from_utf8_lossy(&merge_output.stdout);
        log::error!(
            "[merge-base] Step 4 FAILED: merge => stderr={}, stdout={}",
            stderr,
            stdout
        );
        // Abort merge if in conflict state
        let mut abort_cmd = git_command();
        abort_cmd.arg("-C").arg(path).arg("merge").arg("--abort");
        let _ = run_git_logged(&mut abort_cmd, "merge-base merge abort");
        restore_merge_state(
            path,
            current_branch,
            switched_main,
            &main_worktree_path,
            &original_main_branch,
        );
        return Err(format!(
            "合并 {} 到 {} 失败: {}{}",
            current_branch,
            base_branch,
            stderr,
            if !stdout.is_empty() {
                format!("\n{}", stdout)
            } else {
                String::new()
            }
        ));
    }
    log::info!(
        "[merge-base] Step 4 OK: merged {} into {}",
        current_branch,
        base_branch
    );

    // Step 5: Push
    log::info!("[merge-base] Step 5: git push origin {}", base_branch);
    let mut push_cmd = git_command();
    push_cmd
        .arg("-C")
        .arg(path)
        .arg("push")
        .arg("origin")
        .arg(base_branch)
        .arg("--no-verify");
    let push_output = run_git_logged(&mut push_cmd, "merge-base push target")
        .map_err(|e| format!("执行 git push origin {} 失败: {}", base_branch, e))?;

    let push_failed = !push_output.status.success();
    if push_failed {
        log::error!(
            "[merge-base] Step 5 FAILED: push => {}",
            String::from_utf8_lossy(&push_output.stderr)
        );
    } else {
        log::info!("[merge-base] Step 5 OK: pushed {}", base_branch);
    }

    // Step 6: Restore
    log::info!("[merge-base] Step 6: Restoring original state...");
    restore_merge_state(
        path,
        current_branch,
        switched_main,
        &main_worktree_path,
        &original_main_branch,
    );
    log::info!("[merge-base] Step 6 OK: Restored");

    if push_failed {
        return Err(format!(
            "推送 {} 到远程失败: {}",
            base_branch,
            String::from_utf8_lossy(&push_output.stderr)
        ));
    }

    let mut result = format!("成功将 {} 合并到 {}", current_branch, base_branch);
    if switched_main {
        result.push_str("\n\n✓ 主工作区已临时切换并已恢复");
    }

    log::info!("[merge-base] ===== DONE merge_to_base_branch =====");
    Ok(result)
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
    let full_path = path.join(file_path);

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

    #[serial]
    #[test]
    fn find_main_worktree_returns_main_for_linked_worktree() {
        let repo = make_test_repo();
        let path = repo.path();
        let linked_parent = tempfile::tempdir().expect("create linked worktree parent");
        let linked = linked_parent.path().join("linked-main");

        run_git(path, &["worktree", "add", linked.to_str().unwrap(), "main"]);

        let main = find_main_worktree(&linked).expect("linked worktree resolves main path");

        assert_eq!(
            std::fs::canonicalize(main).expect("canonical main worktree"),
            std::fs::canonicalize(path).expect("canonical repo path")
        );
    }

    #[serial]
    #[test]
    fn find_main_worktree_ignores_plain_dirs_and_malformed_git_files() {
        let temp = tempfile::tempdir().expect("create temp dir");

        assert_eq!(find_main_worktree(temp.path()), None);

        std::fs::write(temp.path().join(".git"), "not a gitdir pointer")
            .expect("write malformed .git file");

        assert_eq!(find_main_worktree(temp.path()), None);
    }

    #[serial]
    #[test]
    fn handle_branch_checkout_conflict_noops_when_main_on_different_branch() {
        let repo = make_test_repo();
        let path = repo.path();

        let result = handle_branch_checkout_conflict(path, "main")
            .expect("different current branch does not need detach");

        assert_eq!(result, (false, None));
        assert_eq!(
            git_output(path, &["branch", "--show-current"]),
            "feature/demo"
        );
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
    fn handle_branch_checkout_conflict_detaches_clean_matching_main_worktree() {
        let repo = make_test_repo();
        let path = repo.path();

        let result = handle_branch_checkout_conflict(path, "feature/demo")
            .expect("handle branch checkout conflict");

        assert_eq!(result, (true, Some("feature/demo".to_string())));
        assert_eq!(
            git_output(path, &["rev-parse", "--abbrev-ref", "HEAD"]),
            "HEAD"
        );

        run_git(path, &["checkout", "feature/demo"]);
        assert_eq!(
            git_output(path, &["branch", "--show-current"]),
            "feature/demo"
        );
    }

    #[serial]
    #[test]
    fn handle_branch_checkout_conflict_rejects_dirty_matching_main_worktree() {
        let repo = make_test_repo();
        let path = repo.path();
        std::fs::write(path.join("dirty.txt"), "dirty\n").expect("write dirty file");

        let err = handle_branch_checkout_conflict(path, "feature/demo").unwrap_err();

        assert!(err.contains("feature/demo"), "{err}");
        assert!(err.contains("未提交的更改"), "{err}");
        assert_eq!(
            git_output(path, &["branch", "--show-current"]),
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
        assert_eq!(
            git_output(path, &["branch", "--show-current"]),
            "feature/demo"
        );
        run_git(
            path,
            &["merge-base", "--is-ancestor", "feature/demo", "origin/test"],
        );
    }

    #[serial]
    #[test]
    fn merge_to_base_branch_reports_checkout_error_for_nonexistent_branch() {
        let repo = make_test_repo();

        let err = merge_to_base_branch(repo.path(), "does-not-exist").unwrap_err();

        assert!(err.contains("切换到 does-not-exist 分支失败"), "{err}");
        assert_eq!(
            git_output(repo.path(), &["branch", "--show-current"]),
            "feature/demo"
        );
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
        assert_eq!(
            git_output(path, &["branch", "--show-current"]),
            "feature/demo"
        );
        run_git(path, &["fetch", "origin"]);
        run_git(
            path,
            &["merge-base", "--is-ancestor", "feature/demo", "origin/main"],
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

        let result = merge_to_test_branch(path, "test").expect("merge detached HEAD to test");
        assert!(result.contains("成功将 HEAD 合并到 test"), "{result}");
        assert_eq!(
            git_output(path, &["rev-parse", "--abbrev-ref", "HEAD"]),
            "test"
        );
        let ancestor = Command::new("git")
            .args(["merge-base", "--is-ancestor", &head, "origin/test"])
            .current_dir(path)
            .status()
            .expect("check detached commit ancestry");
        assert!(
            !ancestor.success(),
            "detached commit should not currently be merged despite success message"
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
}
