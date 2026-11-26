use axum::{
    extract::{Json, Request},
    http::{header, HeaderMap, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use serde_json::Value;
use tower_http::limit::RequestBodyLimitLayer;

use super::{
    get_param, h_check_worktree_status, h_commit_all, h_fetch_project_remote,
    h_get_branch_diff_stats, h_get_changed_files, h_get_current_workspace,
    h_get_main_workspace_status, h_get_remote_branches, h_list_workspaces, h_list_worktrees,
    h_mcp_archive_worktree, h_mcp_delete_archived_worktree, h_mcp_restore_worktree,
    h_merge_to_test_branch, h_pull_current_branch, h_push_to_remote, h_request_mcp_confirm,
    h_switch_workspace, h_sync_with_base_branch,
    middleware::{security_headers_middleware, session_id},
    normalize_path, result_json, result_ok,
    routing::h_mcp_config,
};
fn is_loopback_host_header(host: &str) -> bool {
    let host = host.trim();
    if host.is_empty() {
        return false;
    }

    // Handle bracketed IPv6 host `[::1]` or `[::1]:port`
    if let Some(rest) = host.strip_prefix("[::1]") {
        return rest.is_empty()
            || rest
                .strip_prefix(':')
                .is_some_and(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()));
    }

    let (hostname, port_opt) = match host.rsplit_once(':') {
        Some((h, p)) if !h.contains(':') => (h, Some(p)),
        _ => (host, None),
    };

    if let Some(port) = port_opt {
        if port.is_empty() || !port.chars().all(|c| c.is_ascii_digit()) {
            return false;
        }
    }

    hostname.eq_ignore_ascii_case("localhost") || hostname == "127.0.0.1"
}

/// Guard middleware for the always-on local MCP HTTP server (`127.0.0.1:<port>`).
///
/// Defends against:
/// - DNS Rebinding (strict loopback `Host` header check)
/// - Browser cross-origin CSRF / fetch (rejects `Origin`, `Referer`, `Sec-Fetch-Site`,
///   and requires `application/json` on `POST`)
///
/// Read/query operations and `merge_to_test_branch` remain frictionless for local MCP clients;
/// create/delete/archive/restore/deploy and `merge_to_base_branch` (including UAT) enforce an
/// interactive desktop confirmation dialog on the server side.
pub(super) async fn mcp_guard_middleware(request: Request, next: Next) -> Response {
    let headers = request.headers();

    // 1. Strict Host header check (prevents DNS rebinding from evil.com -> 127.0.0.1)
    let host_ok = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .is_some_and(is_loopback_host_header);
    if !host_ok {
        return (StatusCode::FORBIDDEN, "Invalid Host header").into_response();
    }

    // 2. Reject browser-originated requests (MCP transport is Node axios, never sends these)
    if headers.contains_key(header::ORIGIN)
        || headers.contains_key(header::REFERER)
        || headers.contains_key("sec-fetch-site")
    {
        return (StatusCode::FORBIDDEN, "Browser requests are not allowed").into_response();
    }

    // 3. Require JSON Content-Type on POST (blocks simple-request CSRF even if headers stripped)
    if request.method() == Method::POST {
        let is_json = headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|ct| {
                ct.split(';')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .eq_ignore_ascii_case("application/json")
            });
        if !is_json {
            return (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Content-Type must be application/json",
            )
                .into_response();
        }
    }

    next.run(request).await
}

async fn h_mcp_create_worktree(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let raw_req = args.get("request").cloned().unwrap_or(args);
    let request: crate::CreateWorktreeRequest = match serde_json::from_value(raw_req) {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response()
        }
    };

    let summary = format!(
        "将创建需求工作区 {}（包含 {} 个项目）。",
        request.name,
        request.projects.len()
    );
    if let Err(error) =
        crate::commands::mcp::request_mcp_confirm("创建需求工作区".to_string(), summary).await
    {
        return (StatusCode::BAD_REQUEST, error).into_response();
    }

    let sid = session_id(&headers);
    result_json(crate::create_worktree_impl(&sid, request))
}

async fn h_mcp_create_workspace(Json(args): Json<Value>) -> Response {
    let name = args["name"].as_str().unwrap_or("").trim().to_string();
    let path = args["path"].as_str().unwrap_or("").trim().to_string();
    if name.is_empty() || path.is_empty() {
        return (StatusCode::BAD_REQUEST, "name and path are required").into_response();
    }

    let summary = format!("将创建工作区 {}（路径：{}）。", name, path);
    if let Err(error) =
        crate::commands::mcp::request_mcp_confirm("创建工作区".to_string(), summary).await
    {
        return (StatusCode::BAD_REQUEST, error).into_response();
    }

    result_ok(crate::create_workspace_internal(&name, &path))
}

async fn h_mcp_remove_workspace(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").trim().to_string();
    if path.is_empty() {
        return (StatusCode::BAD_REQUEST, "path is required").into_response();
    }

    let summary = format!("将从应用中移除工作区 {}。这不删除磁盘上的仓库。", path);
    if let Err(error) =
        crate::commands::mcp::request_mcp_confirm("移除工作区".to_string(), summary).await
    {
        return (StatusCode::BAD_REQUEST, error).into_response();
    }

    result_ok(crate::remove_workspace_internal(&path))
}
async fn h_mcp_deploy_to_main(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let worktree_name = get_param(&args, "worktree_name").trim().to_string();
    if worktree_name.is_empty() {
        return (StatusCode::BAD_REQUEST, "worktree_name is required").into_response();
    }

    let summary = format!("将把需求工作区 {} 部署到主工作区。", worktree_name);
    if let Err(error) =
        crate::commands::mcp::request_mcp_confirm("部署到主工作区".to_string(), summary).await
    {
        return (StatusCode::BAD_REQUEST, error).into_response();
    }

    let sid = session_id(&headers);
    result_json(crate::deploy_to_main_impl(&sid, worktree_name))
}

async fn h_mcp_merge_to_base_branch(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").trim().to_string();
    let base_branch = get_param(&args, "base_branch").trim().to_string();
    if path.is_empty() || base_branch.is_empty() {
        return (StatusCode::BAD_REQUEST, "path and base_branch are required").into_response();
    }

    let normalized = normalize_path(&path);
    let branch_probe_path = normalized.clone();
    let current_branch = tokio::task::spawn_blocking(move || {
        crate::git_ops::current_branch_for_merge(std::path::Path::new(&branch_probe_path)).ok()
    })
    .await
    .ok()
    .flatten();

    if let Some(ref branch) = current_branch {
        if let Err(error) = crate::git_ops::validate_merge_source_branch(
            std::path::Path::new(&normalized),
            branch,
            &base_branch,
        ) {
            return (StatusCode::BAD_REQUEST, error).into_response();
        }
    }

    let title = if base_branch.eq_ignore_ascii_case("uat") {
        "合并到 UAT"
    } else {
        "合并到基线"
    };
    let summary = match current_branch {
        Some(branch) => format!(
            "将把 {} 的分支 {} 合并到 {}。",
            normalized, branch, base_branch
        ),
        None => format!("将把 {} 的当前分支合并到 {}。", normalized, base_branch),
    };
    if let Err(error) = crate::commands::mcp::request_mcp_confirm(title.to_string(), summary).await
    {
        return (StatusCode::BAD_REQUEST, error).into_response();
    }

    let result = tokio::task::spawn_blocking(move || {
        crate::git_ops::merge_to_base_branch(std::path::Path::new(&normalized), &base_branch)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
    .and_then(|r| r);
    result_json(result)
}

async fn h_mcp_switch_branch(Json(args): Json<Value>) -> Response {
    let request: crate::SwitchBranchRequest = if let Some(nested) = args.get("request") {
        match serde_json::from_value(nested.clone()) {
            Ok(r) => r,
            Err(e) => {
                return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response()
            }
        }
    } else {
        let project_path = args
            .get("project_path")
            .or_else(|| args.get("projectPath"))
            .or_else(|| args.get("path"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let branch = args
            .get("branch")
            .or_else(|| args.get("branch_name"))
            .or_else(|| args.get("branchName"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if project_path.is_empty() || branch.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                "Invalid request: project_path and branch are required",
            )
                .into_response();
        }
        crate::SwitchBranchRequest {
            project_path,
            branch,
        }
    };
    let result = tokio::task::spawn_blocking(move || crate::switch_branch_internal(&request))
        .await
        .map_err(|e| format!("Task join error: {}", e))
        .and_then(|r| r);
    result_ok(result)
}

/// Minimal router exposed exclusively on `127.0.0.1:<mcp_port>` for `@worktree-manager/mcp`.
///
/// Intentionally omits all PTY/shell, sharing/tunnel control, credential getters/setters,
/// cloud/vault, system-exec (`open_in_*`), MCP config mutation, and WebSocket routes.
/// Create/delete/archive/restore/deploy and `merge_to_base_branch` (UAT/base) endpoints
/// enforce desktop confirmation on the server side; `merge_to_test_branch` does not.
pub(super) fn build_mcp_router() -> Router {
    Router::new()
        .route("/api/mcp/config", post(h_mcp_config))
        .route("/api/list_workspaces", post(h_list_workspaces))
        .route("/api/get_current_workspace", post(h_get_current_workspace))
        .route("/api/switch_workspace", post(h_switch_workspace))
        .route("/api/create_workspace", post(h_mcp_create_workspace))
        .route("/api/remove_workspace", post(h_mcp_remove_workspace))
        .route("/api/list_worktrees", post(h_list_worktrees))
        .route(
            "/api/get_main_workspace_status",
            post(h_get_main_workspace_status),
        )
        .route("/api/create_worktree", post(h_mcp_create_worktree))
        .route("/api/check_worktree_status", post(h_check_worktree_status))
        .route("/api/deploy_to_main", post(h_mcp_deploy_to_main))
        .route("/api/mcp/archive_worktree", post(h_mcp_archive_worktree))
        .route("/api/mcp/restore_worktree", post(h_mcp_restore_worktree))
        .route(
            "/api/mcp/delete_archived_worktree",
            post(h_mcp_delete_archived_worktree),
        )
        .route("/api/mcp/request_confirm", post(h_request_mcp_confirm))
        .route("/api/get_branch_diff_stats", post(h_get_branch_diff_stats))
        .route("/api/get_changed_files", post(h_get_changed_files))
        .route("/api/get_remote_branches", post(h_get_remote_branches))
        .route("/api/commit_all", post(h_commit_all))
        .route("/api/push_to_remote", post(h_push_to_remote))
        .route("/api/switch_branch", post(h_mcp_switch_branch))
        .route("/api/fetch_project_remote", post(h_fetch_project_remote))
        .route("/api/pull_current_branch", post(h_pull_current_branch))
        .route("/api/sync_with_base_branch", post(h_sync_with_base_branch))
        .route("/api/merge_to_test_branch", post(h_merge_to_test_branch))
        .route(
            "/api/merge_to_base_branch",
            post(h_mcp_merge_to_base_branch),
        )
        .layer(axum::middleware::from_fn(mcp_guard_middleware))
        .layer(axum::middleware::from_fn(security_headers_middleware))
        .layer(RequestBodyLimitLayer::new(1024 * 1024))
}
