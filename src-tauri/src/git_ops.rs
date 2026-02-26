use git2::{Repository, StatusOptions};
use serde::Serialize;
use std::path::Path;
use std::process::Command;

/// Helper function to find the main worktree path for a given repository
fn find_main_worktree(repo_path: &Path) -> Option<std::path::PathBuf> {
    let git_path = repo_path.join(".git");
    if git_path.is_dir() {
        log::debug!("[merge] repo_path={} is the main worktree itself", repo_path.display());
        return Some(repo_path.to_path_buf());
    } else if git_path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&git_path) {
            if let Some(gitdir) = content.strip_prefix("gitdir: ") {
                let gitdir = gitdir.trim();
                if let Some(worktrees_idx) = gitdir.find("/.git/worktrees/") {
                    let main_path = &gitdir[..worktrees_idx];
                    log::debug!("[merge] Linked worktree detected. Main worktree: {}", main_path);
                    return Some(std::path::PathBuf::from(main_path));
                }
            }
        }
    }
    log::debug!("[merge] Could not find main worktree for {}", repo_path.display());
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
        target_branch, main_worktree_path.display()
    );

    let repo = Repository::open(main_worktree_path)
        .map_err(|e| format!("无法打开主工作区仓库 ({}): {}", main_worktree_path.display(), e))?;

    if let Ok(head) = repo.head() {
        let current_branch = head.shorthand().unwrap_or("<detached>");
        log::info!(
            "[merge] Main worktree current branch: {}, target: {}",
            current_branch, target_branch
        );

        if current_branch == target_branch {
            log::info!("[merge] Branch conflict detected! Checking uncommitted changes...");

            let status_output = Command::new("git")
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

            let head_commit = head.peel_to_commit()
                .map_err(|e| format!("获取 HEAD commit 失败: {}", e))?;
            let commit_sha = head_commit.id().to_string();

            log::info!(
                "[merge] Main worktree is clean. Switching to detached HEAD at {}",
                &commit_sha[..8]
            );

            let checkout_output = Command::new("git")
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
                return Err(format!(
                    "无法将主工作区切换到 detached HEAD: {}", stderr
                ));
            }

            log::info!("[merge] Successfully switched main worktree to detached HEAD");
            return Ok((true, Some(target_branch.to_string())));
        } else {
            log::info!("[merge] No branch conflict (main={}, target={})", current_branch, target_branch);
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
    pub ahead_of_base: usize,
    pub behind_base: usize,
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
            ahead_of_base: 0,
            behind_base: 0,
        }
    }
}

pub fn get_worktree_info(path: &Path) -> WorktreeInfo {
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

    // Get uncommitted changes count
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(false);

    if let Ok(statuses) = repo.statuses(Some(&mut opts)) {
        info.uncommitted_count = statuses.len();
    }

    // Check if merged to test branch
    // This is a simplified check - just see if test branch ref exists and compare
    let test_branch = get_test_branch_for_path(path);
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
        }
    }

    // Get ahead/behind count relative to base branch
    let base_branch = get_base_branch_for_path(path);
    if let Ok(base_ref) = repo.find_reference(&format!("refs/remotes/origin/{}", base_branch)) {
        if let Ok(head) = repo.head() {
            if let (Ok(base_oid), Ok(head_oid)) =
                (base_ref.target().ok_or(()), head.target().ok_or(()))
            {
                if let Ok((ahead, behind)) = repo.graph_ahead_behind(head_oid, base_oid) {
                    info.ahead_of_base = ahead;
                    info.behind_base = behind;
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

pub fn get_branch_status(path: &Path, project_name: &str) -> BranchStatus {
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
                let base_branch = get_base_branch_for_path(path);
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
    // First, fetch from remote
    let fetch_output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("fetch")
        .arg("origin")
        .arg(base_branch)
        .output()
        .map_err(|e| format!("Failed to execute git fetch: {}", e))?;

    if !fetch_output.status.success() {
        return Err(format!(
            "Git fetch failed: {}",
            String::from_utf8_lossy(&fetch_output.stderr)
        ));
    }

    // Then, merge origin/base_branch into current branch
    let merge_output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("merge")
        .arg(format!("origin/{}", base_branch))
        .output()
        .map_err(|e| format!("Failed to execute git merge: {}", e))?;

    if !merge_output.status.success() {
        return Err(format!(
            "Git merge failed: {}",
            String::from_utf8_lossy(&merge_output.stderr)
        ));
    }

    Ok(format!("Successfully synced with {}", base_branch))
}

/// Push current branch to remote
pub fn push_to_remote(path: &Path) -> Result<String, String> {
    // Get current branch
    let branch_output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()
        .map_err(|e| format!("Failed to get current branch: {}", e))?;

    if !branch_output.status.success() {
        return Err("Failed to get current branch".to_string());
    }

    let current_branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    // Push to remote
    let push_output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("push")
        .arg("-u")
        .arg("origin")
        .arg(&current_branch)
        .output()
        .map_err(|e| format!("Failed to execute git push: {}", e))?;

    if !push_output.status.success() {
        return Err(format!(
            "Git push failed: {}",
            String::from_utf8_lossy(&push_output.stderr)
        ));
    }

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
    let restore = Command::new("git")
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
            let restore_output = Command::new("git")
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
                    log::error!("[merge] Failed to execute git checkout for main restore: {}", e);
                }
            }
        }
    }
}

/// Merge current branch to test branch
pub fn merge_to_test_branch(path: &Path, test_branch: &str) -> Result<String, String> {
    log::info!("[merge-test] ===== START merge_to_test_branch =====");
    log::info!("[merge-test] path={}, test_branch={}", path.display(), test_branch);

    let repo = Repository::open(path)
        .map_err(|e| format!("无法打开仓库 ({}): {}", path.display(), e))?;

    let head = repo
        .head()
        .map_err(|e| format!("无法读取 HEAD ({}): {}", path.display(), e))?;
    let current_branch = head
        .shorthand()
        .ok_or_else(|| format!("无法获取当前分支名 (HEAD 可能处于 detached 状态)"))?;

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
    let checkout_output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("checkout")
        .arg(test_branch)
        .output()
        .map_err(|e| format!("执行 git checkout {} 失败: {}", test_branch, e))?;

    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        log::error!("[merge-test] Step 2 FAILED: checkout {} => {}", test_branch, stderr);
        if switched_main {
            restore_merge_state(path, current_branch, switched_main, &main_worktree_path, &original_main_branch);
        }
        return Err(format!(
            "切换到 {} 分支失败: {}", test_branch, stderr
        ));
    }
    log::info!("[merge-test] Step 2 OK: checked out {}", test_branch);

    // Step 3: Pull latest
    log::info!("[merge-test] Step 3: git pull origin {}", test_branch);
    let pull_output = Command::new("git")
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
        restore_merge_state(path, current_branch, switched_main, &main_worktree_path, &original_main_branch);
        return Err(format!(
            "拉取 {} 最新代码失败: {}", test_branch, stderr
        ));
    }
    log::info!("[merge-test] Step 3 OK: pulled latest {}", test_branch);

    // Step 4: Merge
    log::info!("[merge-test] Step 4: git merge {}", current_branch);
    let merge_output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("merge")
        .arg(current_branch)
        .output()
        .map_err(|e| format!("执行 git merge {} 失败: {}", current_branch, e))?;

    if !merge_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_output.stderr);
        let stdout = String::from_utf8_lossy(&merge_output.stdout);
        log::error!("[merge-test] Step 4 FAILED: merge => stderr={}, stdout={}", stderr, stdout);
        // Abort merge if in conflict state
        let _ = Command::new("git").arg("-C").arg(path).arg("merge").arg("--abort").output();
        restore_merge_state(path, current_branch, switched_main, &main_worktree_path, &original_main_branch);
        return Err(format!(
            "合并 {} 到 {} 失败: {}{}", current_branch, test_branch, stderr,
            if !stdout.is_empty() { format!("\n{}", stdout) } else { String::new() }
        ));
    }
    log::info!("[merge-test] Step 4 OK: merged {} into {}", current_branch, test_branch);

    // Step 5: Push
    log::info!("[merge-test] Step 5: git push origin {}", test_branch);
    let push_output = Command::new("git")
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
    restore_merge_state(path, current_branch, switched_main, &main_worktree_path, &original_main_branch);
    log::info!("[merge-test] Step 6 OK: Restored");

    if push_failed {
        return Err(format!(
            "推送 {} 到远程失败: {}",
            test_branch,
            String::from_utf8_lossy(&push_output.stderr)
        ));
    }

    let mut result = format!(
        "成功将 {} 合并到 {}", current_branch, test_branch
    );
    if switched_main {
        result.push_str("\n\n✓ 主工作区已临时切换并已恢复");
    }

    log::info!("[merge-test] ===== DONE merge_to_test_branch =====");
    Ok(result)
}

/// Merge current branch to base branch
pub fn merge_to_base_branch(path: &Path, base_branch: &str) -> Result<String, String> {
    log::info!("[merge-base] ===== START merge_to_base_branch =====");
    log::info!("[merge-base] path={}, base_branch={}", path.display(), base_branch);

    let repo = Repository::open(path)
        .map_err(|e| format!("无法打开仓库 ({}): {}", path.display(), e))?;

    let head = repo
        .head()
        .map_err(|e| format!("无法读取 HEAD ({}): {}", path.display(), e))?;
    let current_branch = head
        .shorthand()
        .ok_or_else(|| format!("无法获取当前分支名 (HEAD 可能处于 detached 状态)"))?;

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
    let checkout_output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("checkout")
        .arg(base_branch)
        .output()
        .map_err(|e| format!("执行 git checkout {} 失败: {}", base_branch, e))?;

    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        log::error!("[merge-base] Step 2 FAILED: checkout {} => {}", base_branch, stderr);
        if switched_main {
            restore_merge_state(path, current_branch, switched_main, &main_worktree_path, &original_main_branch);
        }
        return Err(format!(
            "切换到 {} 分支失败: {}", base_branch, stderr
        ));
    }
    log::info!("[merge-base] Step 2 OK: checked out {}", base_branch);

    // Step 3: Pull latest
    log::info!("[merge-base] Step 3: git pull origin {}", base_branch);
    let pull_output = Command::new("git")
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
        restore_merge_state(path, current_branch, switched_main, &main_worktree_path, &original_main_branch);
        return Err(format!(
            "拉取 {} 最新代码失败: {}", base_branch, stderr
        ));
    }
    log::info!("[merge-base] Step 3 OK: pulled latest {}", base_branch);

    // Step 4: Merge
    log::info!("[merge-base] Step 4: git merge {}", current_branch);
    let merge_output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("merge")
        .arg(current_branch)
        .output()
        .map_err(|e| format!("执行 git merge {} 失败: {}", current_branch, e))?;

    if !merge_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_output.stderr);
        let stdout = String::from_utf8_lossy(&merge_output.stdout);
        log::error!("[merge-base] Step 4 FAILED: merge => stderr={}, stdout={}", stderr, stdout);
        // Abort merge if in conflict state
        let _ = Command::new("git").arg("-C").arg(path).arg("merge").arg("--abort").output();
        restore_merge_state(path, current_branch, switched_main, &main_worktree_path, &original_main_branch);
        return Err(format!(
            "合并 {} 到 {} 失败: {}{}", current_branch, base_branch, stderr,
            if !stdout.is_empty() { format!("\n{}", stdout) } else { String::new() }
        ));
    }
    log::info!("[merge-base] Step 4 OK: merged {} into {}", current_branch, base_branch);

    // Step 5: Push
    log::info!("[merge-base] Step 5: git push origin {}", base_branch);
    let push_output = Command::new("git")
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
    restore_merge_state(path, current_branch, switched_main, &main_worktree_path, &original_main_branch);
    log::info!("[merge-base] Step 6 OK: Restored");

    if push_failed {
        return Err(format!(
            "推送 {} 到远程失败: {}",
            base_branch,
            String::from_utf8_lossy(&push_output.stderr)
        ));
    }

    let mut result = format!(
        "成功将 {} 合并到 {}", current_branch, base_branch
    );
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

pub fn detect_git_platform(path: &Path) -> Result<GitPlatform, String> {
    let remote_output = Command::new("git")
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
    // Detect platform
    let platform = detect_git_platform(path)?;

    match platform {
        GitPlatform::GitHub => {
            // Check if gh CLI is available
            let gh_check = Command::new("gh").arg("--version").output().map_err(|_| {
                "gh CLI is not installed. Please install it from https://cli.github.com/"
                    .to_string()
            })?;

            if !gh_check.status.success() {
                return Err("gh CLI is not available".to_string());
            }

            // Create PR using gh CLI
            let pr_output = Command::new("gh")
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
                return Err(format!(
                    "Failed to create PR: {}",
                    String::from_utf8_lossy(&pr_output.stderr)
                ));
            }

            let pr_url = String::from_utf8_lossy(&pr_output.stdout)
                .trim()
                .to_string();
            Ok(pr_url)
        }
        GitPlatform::GitLab => {
            // Get current branch
            let branch_output = Command::new("git")
                .arg("-C")
                .arg(path)
                .arg("rev-parse")
                .arg("--abbrev-ref")
                .arg("HEAD")
                .output()
                .map_err(|e| format!("Failed to get current branch: {}", e))?;

            if !branch_output.status.success() {
                return Err("Failed to get current branch".to_string());
            }

            let current_branch = String::from_utf8_lossy(&branch_output.stdout)
                .trim()
                .to_string();

            // Push with merge request creation options
            // GitLab supports creating MR via git push options
            let push_output = Command::new("git")
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
                return Err(format!("Failed to create MR: {}", stderr));
            }

            // Extract MR URL from output
            let output_str = String::from_utf8_lossy(&push_output.stderr);

            // GitLab outputs the MR URL in stderr, look for it
            for line in output_str.lines() {
                if line.contains("merge_request") || line.contains("/merge_requests/") {
                    // Try to extract URL
                    if let Some(url_start) = line.find("http") {
                        let url_part = &line[url_start..];
                        if let Some(url_end) = url_part.find(char::is_whitespace) {
                            return Ok(url_part[..url_end].to_string());
                        } else {
                            return Ok(url_part.to_string());
                        }
                    }
                }
            }

            // If we can't find the URL, return a success message
            Ok(format!(
                "MR created successfully for branch {} -> {}",
                current_branch, base_branch
            ))
        }
        GitPlatform::Unknown => {
            Err("Unknown git platform. Only GitHub and GitLab are supported.".to_string())
        }
    }
}

/// Fetch from remote origin (updates remote-tracking branches)
pub fn fetch_remote(path: &Path) -> Result<(), String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("fetch")
        .arg("origin")
        .output()
        .map_err(|e| format!("Failed to execute git fetch: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Git fetch failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

/// Check if a remote branch exists
pub fn check_remote_branch_exists(path: &Path, branch_name: &str) -> Result<bool, String> {
    // Check locally if the remote-tracking branch exists (no network call).
    // Remote-tracking branches are updated by git fetch/pull/push operations,
    // so this is accurate enough for UI button state.
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("branch")
        .arg("-r")
        .arg("--list")
        .arg(format!("origin/{}", branch_name))
        .output()
        .map_err(|e| format!("Failed to execute git branch: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Git branch check failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    Ok(!output_str.trim().is_empty())
}

/// Get list of remote branches
pub fn get_remote_branches(path: &Path) -> Result<Vec<String>, String> {
    // Fetch from remote to ensure we have the latest branch info
    let fetch_output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("fetch")
        .arg("origin")
        .output()
        .map_err(|e| format!("Failed to execute git fetch: {}", e))?;

    if !fetch_output.status.success() {
        return Err(format!(
            "Git fetch failed: {}",
            String::from_utf8_lossy(&fetch_output.stderr)
        ));
    }

    // Get list of remote branches
    let ls_remote_output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("ls-remote")
        .arg("--heads")
        .arg("origin")
        .output()
        .map_err(|e| format!("Failed to execute git ls-remote: {}", e))?;

    if !ls_remote_output.status.success() {
        return Err(format!(
            "Git ls-remote failed: {}",
            String::from_utf8_lossy(&ls_remote_output.stderr)
        ));
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

    Ok(branches)
}
