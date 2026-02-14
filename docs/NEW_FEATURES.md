# 新功能说明

本文档详细说明本次版本新增的功能和优化。

## 1. Git 操作功能

### 概述
集成了常用的 Git 操作，简化分支管理和代码合并流程，提升开发效率。

### 1.1 同步基础分支 (Sync with Base Branch)

#### 功能描述
将基础分支（如 `main`、`uat`）的最新代码合并到当前分支，保持分支与主分支同步。

#### 实现细节

**前端实现** (`src/components/GitOperations.tsx`):
```typescript
const handleSync = async () => {
  setSyncing(true);
  try {
    const result = await syncWithBaseBranch(projectPath, baseBranch);
    setSuccess(result);
    await loadStats();
    onRefresh?.();
  } catch (err) {
    setError(err.message);
  } finally {
    setSyncing(false);
  }
};
```

**后端实现** (`src-tauri/src/lib.rs`):
```rust
#[tauri::command]
async fn sync_with_base_branch(
    project_path: String,
    base_branch: String,
) -> Result<String, String> {
    // 1. git fetch origin
    let fetch = Command::new("git")
        .args(&["fetch", "origin"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to fetch: {}", e))?;

    // 2. git merge origin/{base_branch}
    let merge = Command::new("git")
        .args(&["merge", &format!("origin/{}", base_branch)])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to merge: {}", e))?;

    Ok(format!("Successfully synced with {}", base_branch))
}
```

#### 使用场景
- 开发新功能前，先同步主分支的最新代码
- 解决分支落后主分支的问题
- 减少合并冲突

#### UI 展示
- 按钮：带有同步图标的 "同步基础分支" 按钮
- 状态：显示同步中、成功或失败状态
- 反馈：显示操作结果消息

---

### 1.2 合并到测试分支 (Merge to Test Branch)

#### 功能描述
将当前分支合并到测试分支（如 `test`、`staging`），用于部署到测试环境。

#### 实现细节

**后端实现**:
```rust
#[tauri::command]
async fn merge_to_test_branch(
    project_path: String,
    test_branch: String,
) -> Result<String, String> {
    let current_branch = get_current_branch(&project_path)?;

    // 1. git checkout {test_branch}
    Command::new("git")
        .args(&["checkout", &test_branch])
        .current_dir(&project_path)
        .output()?;

    // 2. git merge {current_branch}
    Command::new("git")
        .args(&["merge", &current_branch])
        .current_dir(&project_path)
        .output()?;

    // 3. git push origin {test_branch}
    Command::new("git")
        .args(&["push", "origin", &test_branch])
        .current_dir(&project_path)
        .output()?;

    // 4. git checkout {current_branch}
    Command::new("git")
        .args(&["checkout", &current_branch])
        .current_dir(&project_path)
        .output()?;

    Ok(format!("Successfully merged to {}", test_branch))
}
```

#### 使用场景
- 功能开发完成，需要部署到测试环境
- 快速将多个分支合并到测试分支
- 自动化测试部署流程

#### 注意事项
- 操作会自动切换分支并推送到远程
- 如果有冲突，操作会失败并提示
- 建议在合并前先同步基础分支

---

### 1.3 创建 Pull Request

#### 功能描述
在 Git 托管平台（GitHub/GitLab）创建 Pull Request 或 Merge Request。

#### 实现细节

**前端实现**:
```typescript
const handleCreatePR = async () => {
  const title = window.prompt(`创建 PR 标题 (${currentBranch} -> ${baseBranch}):`);
  if (!title) return;

  const body = window.prompt('PR 描述 (可选):') || '';

  setCreatingPR(true);
  try {
    const prUrl = await createPullRequest(projectPath, baseBranch, title, body);
    setSuccess(`PR 创建成功: ${prUrl}`);
  } catch (err) {
    setError(err.message);
  } finally {
    setCreatingPR(false);
  }
};
```

**后端实现**:
```rust
#[tauri::command]
async fn create_pull_request(
    project_path: String,
    base_branch: String,
    title: String,
    body: String,
) -> Result<String, String> {
    let current_branch = get_current_branch(&project_path)?;
    let remote_url = get_remote_url(&project_path)?;

    // 检测平台类型
    if remote_url.contains("github.com") {
        // 使用 gh CLI
        let output = Command::new("gh")
            .args(&[
                "pr", "create",
                "--base", &base_branch,
                "--head", &current_branch,
                "--title", &title,
                "--body", &body,
            ])
            .current_dir(&project_path)
            .output()?;

        // 解析输出获取 PR URL
        let pr_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(pr_url)
    } else if remote_url.contains("gitlab.com") {
        // 使用 glab CLI
        let output = Command::new("glab")
            .args(&[
                "mr", "create",
                "--target-branch", &base_branch,
                "--source-branch", &current_branch,
                "--title", &title,
                "--description", &body,
            ])
            .current_dir(&project_path)
            .output()?;

        let mr_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(mr_url)
    } else {
        Err("Unsupported Git platform".to_string())
    }
}
```

#### 支持的平台
- **GitHub**：使用 `gh` CLI
- **GitLab**：使用 `glab` CLI

#### 前置条件
- 需要安装对应的 CLI 工具
- 需要配置 CLI 工具的认证

#### 使用场景
- 功能开发完成，创建 PR 进行代码审查
- 快速创建 PR，无需打开浏览器
- 自动填充分支信息

---

### 1.4 分支差异展示

#### 功能描述
显示当前分支与基础分支的差异统计，包括文件变更和代码行数变更。

#### 实现细节

**数据结构**:
```typescript
interface BranchDiffStats {
  files_changed: number;
  insertions: number;
  deletions: number;
  ahead: number;
  behind: number;
}
```

**后端实现**:
```rust
#[tauri::command]
async fn get_branch_diff_stats(
    project_path: String,
    base_branch: String,
) -> Result<BranchDiffStats, String> {
    // git diff --stat origin/{base_branch}...HEAD
    let output = Command::new("git")
        .args(&[
            "diff",
            "--stat",
            &format!("origin/{}...HEAD", base_branch),
        ])
        .current_dir(&project_path)
        .output()?;

    let stats_text = String::from_utf8_lossy(&output.stdout);

    // 解析统计信息
    let stats = parse_diff_stats(&stats_text)?;

    Ok(stats)
}
```

#### UI 展示
- **文件变更**：显示修改的文件数量
- **新增行数**：绿色显示新增的代码行数
- **删除行数**：红色显示删除的代码行数
- **Ahead/Behind**：显示与基础分支的提交差异

#### 使用场景
- 了解当前分支的变更规模
- 评估合并的影响范围
- 代码审查前的预览

---

## 2. 远程客户端 Kick 操作

### 概述
新增了踢出远程客户端的功能，允许主机强制断开指定客户端的连接。

### 2.1 功能实现

#### 前端实现 (`src/App.tsx`):
```typescript
const handleKickClient = async (sessionId: string) => {
  if (!confirm('确定要踢出该客户端吗？')) return;

  try {
    await kickClient(sessionId);
    // 刷新客户端列表
    const clients = await getConnectedClients();
    setConnectedClients(clients);
  } catch (err) {
    console.error('Failed to kick client:', err);
  }
};
```

#### 后端实现 (`src-tauri/src/lib.rs`):
```rust
#[tauri::command]
async fn kick_client(session_id: String) -> Result<(), String> {
    // 1. 从认证会话中移除
    {
        let mut sessions = AUTHENTICATED_SESSIONS.lock().unwrap();
        sessions.remove(&session_id);
    }

    // 2. 从连接的客户端列表中移除
    {
        let mut clients = CONNECTED_CLIENTS.lock().unwrap();
        clients.remove(&session_id);
    }

    // 3. 通过 WebSocket 广播断开消息
    if let Ok(tx) = LOCK_BROADCAST.lock() {
        let _ = tx.send(json!({
            "type": "kick",
            "session_id": session_id,
        }));
    }

    Ok(())
}
```

#### WebSocket 处理 (`src-tauri/src/http_server.rs`):
```rust
// 客户端接收到 kick 消息后自动断开
if msg["type"] == "kick" && msg["session_id"] == current_session_id {
    // 关闭 WebSocket 连接
    let _ = sender.close().await;
    break;
}
```

### 2.2 UI 展示

#### 客户端列表
- 显示所有连接的客户端
- 每个客户端显示：
  - 会话 ID（前 8 位）
  - IP 地址
  - 连接时间
  - 用户代理

#### Kick 按钮
- 每个客户端旁边有 "踢出" 按钮
- 点击后弹出确认对话框
- 操作成功后自动刷新列表

### 2.3 使用场景
- 移除未授权的访问
- 清理闲置连接
- 安全管理
- 限制并发连接数

### 2.4 安全性
- 只有主机（桌面应用）可以踢出客户端
- 浏览器客户端无法踢出其他客户端
- 被踢出的客户端需要重新认证才能访问

---

## 3. 分享端口设置优化

### 概述
优化了分享功能的端口设置流程，提供更好的用户体验。

### 3.1 优化内容

#### 首次设置
- 首次启动分享时，弹出端口设置对话框
- 默认端口：3000
- 用户可以自定义端口
- 端口验证：检查端口是否被占用

#### 后续更改
- 分享信息区域显示当前端口
- 端口号可点击
- 点击后弹出更改端口对话框
- 更改端口需要重启分享服务

### 3.2 实现细节

**前端实现**:
```typescript
// 首次设置
const [sharePort, setSharePort] = useState<number | null>(null);

const handleStartSharing = async () => {
  if (sharePort === null) {
    // 弹出端口设置对话框
    setShowPortDialog(true);
    return;
  }

  // 启动分享
  await startSharing(sharePort, password);
};

// 更改端口
const handleChangePort = async () => {
  const newPort = window.prompt('输入新端口:', String(sharePort));
  if (!newPort) return;

  // 停止当前分享
  await stopSharing();

  // 使用新端口启动
  setSharePort(Number(newPort));
  await startSharing(Number(newPort), password);
};
```

### 3.3 端口持久化
- 端口保存到配置文件
- 下次启动时自动加载
- 避免重复设置

### 3.4 用户体验改进
- 清晰的设置流程
- 直观的端口显示
- 方便的更改入口
- 友好的错误提示

---

## 4. 密码生成逻辑优化

### 概述
优化了分享密码的生成和管理逻辑，提升安全性和易用性。

### 4.1 优化内容

#### 自动生成密码
- 启动分享时自动生成随机密码
- 密码长度：8 位
- 字符集：大小写字母 + 数字
- 避免易混淆字符（如 0/O, 1/l）

#### 密码持久化
- 密码保存到配置文件
- 下次启动时自动加载上次的密码
- 用户可以手动更改密码

#### 密码显示
- 明文显示密码（方便分享）
- 支持一键复制
- 支持点击更改

### 4.2 实现细节

**密码生成算法**:
```rust
fn generate_password() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();

    (0..8)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}
```

**密码管理**:
```rust
// 保存密码
fn save_last_password(password: &str) -> Result<(), String> {
    let config_path = get_config_dir()?.join("last_password.txt");
    fs::write(config_path, password)
        .map_err(|e| format!("Failed to save password: {}", e))
}

// 加载密码
fn load_last_password() -> Option<String> {
    let config_path = get_config_dir().ok()?.join("last_password.txt");
    fs::read_to_string(config_path).ok()
}
```

### 4.3 安全性考虑
- 密码随机生成，避免弱密码
- 密码存储在本地配置文件
- 支持用户自定义强密码
- 速率限制防止暴力破解

### 4.4 用户体验改进
- 无需手动输入密码
- 记住上次的密码
- 方便分享和复制
- 支持自定义密码

---

## 5. NGROK 展示逻辑优化

### 概述
优化了 NGROK 功能的展示逻辑，即使未配置 Token 也始终显示 NGROK 区域。

### 5.1 优化内容

#### 始终展示 NGROK 区域
- 无论是否配置 Token，都显示 NGROK 区域
- 未配置时显示 "未配置" 状态
- 已配置时显示隧道状态和 URL

#### 未配置时的提示
- 点击 "启动 NGROK" 按钮时，检查 Token
- 如果未配置，弹出提示对话框
- 引导用户前往设置页面配置 Token

#### 配置流程优化
- 设置页面提供 Token 输入框
- 保存 Token 后自动验证
- 验证成功后可以启动隧道

### 5.2 实现细节

**前端实现**:
```typescript
// 始终显示 NGROK 区域
<div className="ngrok-section">
  <h3>NGROK 隧道</h3>
  {ngrokToken ? (
    <>
      <div>状态: {ngrokActive ? '活动' : '未启动'}</div>
      {ngrokUrl && <div>公网地址: {ngrokUrl}</div>}
      <button onClick={handleToggleNgrok}>
        {ngrokActive ? '停止' : '启动'}
      </button>
    </>
  ) : (
    <>
      <div>状态: 未配置</div>
      <button onClick={handlePromptNgrokSetup}>
        启动 NGROK
      </button>
    </>
  )}
</div>

// 未配置时的提示
const handlePromptNgrokSetup = () => {
  alert('请先在设置页面配置 NGROK Token');
  setViewMode('settings');
};
```

### 5.3 用户体验改进
- 功能入口始终可见
- 清晰的状态提示
- 友好的引导流程
- 避免功能隐藏

### 5.4 状态展示
- **未配置**：显示 "未配置" 和设置引导
- **已配置未启动**：显示 "未启动" 和启动按钮
- **已启动**：显示 "活动"、公网 URL 和停止按钮
- **启动失败**：显示错误信息和重试按钮

---

## 总结

本次更新新增了以下核心功能：

1. **Git 操作集成**：同步分支、合并到测试、创建 PR、查看差异
2. **远程客户端管理**：踢出客户端功能
3. **分享体验优化**：端口设置、密码生成、NGROK 展示

这些功能显著提升了工作效率和用户体验，使 Git Worktree Manager 成为更强大的多分支开发工具。

### 相关文件清单

#### 前端
- `src/components/GitOperations.tsx` - Git 操作组件
- `src/App.tsx` - 分享、客户端管理、NGROK UI
- `src/lib/backend.ts` - 后端 API 调用

#### 后端
- `src-tauri/src/lib.rs` - 新增命令实现
- `src-tauri/src/git_ops.rs` - Git 操作实现
- `src-tauri/src/http_server.rs` - HTTP 服务器和 WebSocket

### 未来计划
- 支持更多 Git 平台（Bitbucket、Gitee 等）
- 增强 Git 操作的可视化
- 支持批量操作多个项目
- 添加 Git 历史查看功能
