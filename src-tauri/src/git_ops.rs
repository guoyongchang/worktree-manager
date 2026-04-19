use git2::{Repository, StatusOptions};
use serde::Serialize;
use std::path::Path;

use crate::utils::git_command;

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
                if let Some(worktrees_idx) = gitdir.find("/.git/worktrees/") {
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

            let checkout_output = git_command()
                .arg("-C")
                .arg(main_worktree_path)
                .arg("checkout")
                .arg("--detach")
                .arg(&commit_sha)
                .output()
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
    let fetch_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("fetch")
        .arg("origin")
        .arg(base_branch)
        .output()
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
    let merge_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("merge")
        .arg(format!("origin/{}", base_branch))
        .output()
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

    // Step 2: Push to remote
    log::info!("[git] Pushing branch '{}' to origin", current_branch);
    let push_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("push")
        .arg("-u")
        .arg("origin")
        .arg(&current_branch)
        .arg("--no-verify")
        .output()
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
    let restore = git_command()
        .arg("-C")
        .arg(path)
        .arg("checkout")
        .arg(original_branch)
        .output();
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
            let restore_output = git_command()
                .arg("-C")
                .arg(main_wt)
                .arg("checkout")
                .arg(orig_branch)
                .output();
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
    let checkout_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("checkout")
        .arg(test_branch)
        .output()
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
    let pull_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("pull")
        .arg("origin")
        .arg(test_branch)
        .output()
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
    let merge_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("merge")
        .arg(current_branch)
        .output()
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
        let _ = git_command()
            .arg("-C")
            .arg(path)
            .arg("merge")
            .arg("--abort")
            .output();
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
    let push_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("push")
        .arg("origin")
        .arg(test_branch)
        .output()
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
    let checkout_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("checkout")
        .arg(base_branch)
        .output()
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
    let pull_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("pull")
        .arg("origin")
        .arg(base_branch)
        .output()
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
    let merge_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("merge")
        .arg(current_branch)
        .output()
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
        let _ = git_command()
            .arg("-C")
            .arg(path)
            .arg("merge")
            .arg("--abort")
            .output();
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
    let push_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("push")
        .arg("origin")
        .arg(base_branch)
        .output()
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
pub fn get_branch_diff_stats(path: &Path, base_branch: &str) -> BranchDiffStats {
    let repo = match Repository::open(path) {
        Ok(r) => r,
        Err(_) => {
            return BranchDiffStats {
                ahead: 0,
                behind: 0,
                changed_files: 0,
            }
        }
    };

    let mut stats = BranchDiffStats {
        ahead: 0,
        behind: 0,
        changed_files: 0,
    };

    // Get ahead/behind count
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
            let gh_available = std::process::Command::new("gh")
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
            let pr_output = std::process::Command::new("gh")
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
            let push_output = git_command()
                .arg("-C")
                .arg(path)
                .arg("push")
                .arg("-u")
                .arg("origin")
                .arg(&current_branch)
                .arg("-o")
                .arg("merge_request.create")
                .arg("-o")
                .arg(format!("merge_request.target={}", base_branch))
                .arg("-o")
                .arg(format!("merge_request.title={}", title))
                .arg("-o")
                .arg(format!("merge_request.description={}", body))
                .output()
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
    let output = git_command()
        .arg("-C")
        .arg(path)
        .arg("fetch")
        .arg("origin")
        .output()
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
    let fetch_output = git_command()
        .arg("-C")
        .arg(path)
        .arg("fetch")
        .arg("origin")
        .output()
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
) -> Result<String, String> {
    log::info!("[git] Committing all changes at: {}", path.display());

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
    let commit_output = cmd
        .args(["commit", "-m", message, "--no-verify"])
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
