# Commit Message 前缀模板与 Git User 配置设计

## 背景

当前 AI 生成 commit message（通过 Dashscope）在无 API Key 时会报错，且 commit message 没有前缀标识。用户在多 worktree/多项目环境下，希望：

1. 无 API Key 时不触发 AI 生成，避免报错
2. 为 commit message 添加可配置的前缀模板（如 `[{{worktree-name}}]`）
3. 可配置 git user.name / user.email（全局 + 按 repo），避免用错身份提交

## 范围

- **前端**：`GitOperations.tsx` commit 对话框、前缀下拉选择、`SettingsView.tsx` 新 section
- **后端**：`types.rs` 配置结构、`config.rs` 存取逻辑、`git_ops.rs` commit 流程、`voice.rs` key 检查
- **HTTP 路由**：所有新增命令同步到 `http_server`

## 数据模型

### GlobalConfig 新增字段（`types.rs`）

```rust
#[serde(default = "default_prefix_templates")]
pub commit_prefix_templates: Vec<String>,  // 最多3个，默认 ["[{{worktree-name}}]"]

#[serde(default = "default_true")]
pub commit_prefix_enabled: bool,  // 前缀功能总开关，默认 true

#[serde(default)]
pub git_user_name: Option<String>,

#[serde(default)]
pub git_user_email: Option<String>,
```

旧配置加载后处理：如果 `commit_prefix_templates` 为空，填充默认模板。

### ProjectConfig 新增字段（`types.rs`）

```rust
#[serde(default)]
pub commit_prefix_index: Option<usize>,  // 用第几个模板，None=0

#[serde(default)]
pub git_user_name: Option<String>,

#[serde(default)]
pub git_user_email: Option<String>,
```

### 变量定义

| 变量 | 含义 | 来源 |
|------|------|------|
| `{{worktree-name}}` | worktree 显示名 | 前端已有（`WorktreeListItem.display_name`） |
| `{{project-name}}` | 项目名称 | 前端已有 |
| `{{branch-name}}` | 当前分支名 | 前端通过 `getGitDiff` 或新增 `get_current_branch` 获取 |
| `{{repo-name}}` | 仓库目录名 | `path.basename()` |
| `{{date}}` | 日期，默认 `YYYY-MM-DD` | JS `Date` |
| `{{date:FMT}}` | 格式化日期 | JS `Date` 简单格式化 |

## 前端 Commit 对话框交互

### 打开对话框时

1. 读取 `projectConfig.commit_prefix_index` → 确定默认模板
2. 替换模板变量得到前缀字符串
3. 调用 `checkDashscopeApiKey()`
   - **有 key**：调用 `generateCommitMessage(diff)` → 拼接 `prefix + msg`
   - **无 key**：输入框只填前缀，留空等待用户手写，不报错

### 新增 UI 元素

- **前缀下拉**：从全局模板列表渲染选项，当前项目默认选中 `commit_prefix_index` 对应的模板
- **临时切换**：下拉选择其他模板只影响本次 commit，不持久化
- **前缀开关**：在 Settings 关闭后，commit 对话框不显示前缀也不拼接

### 变量替换函数（前端）

```typescript
function renderCommitPrefix(template: string, vars: {
  worktreeName: string;
  projectName: string;
  branchName: string;
  repoName: string;
}): string {
  return template
    .replace(/{{worktree-name}}/g, vars.worktreeName)
    .replace(/{{project-name}}/g, vars.projectName)
    .replace(/{{branch-name}}/g, vars.branchName)
    .replace(/{{repo-name}}/g, vars.repoName)
    .replace(/{{date(?::([^}]+))?}}/g, (_, fmt) => formatDate(fmt || 'YYYY-MM-DD'));
}
```

## Git User 配置与提交流程

### 来源优先级（从高到低）

1. `ProjectConfig.git_user_name/email`（非空时）
2. `GlobalConfig.git_user_name/email`（非空时）
3.  repo 已有 git config（不覆盖）

### 提交时执行（`commit_all` 函数）

```
确定最终 name/email →
  A) git config user.name/email （写入 repo，持久化）→
  C) GIT_AUTHOR_NAME/EMAIL 环境变量（提交命令，保底）
```

### commit_all 签名变更

```rust
pub fn commit_all(
    path: &Path,
    message: &str,
    author_name: Option<&str>,
    author_email: Option<&str>,
) -> Result<String, String>
```

## 新增后端命令

| 命令 | 返回值 | 用途 |
|------|--------|------|
| `get_commit_prefix_config` | `{templates: string[], enabled: bool}` | 读全局前缀配置 |
| `set_commit_prefix_config(templates, enabled)` | `void` | 写全局前缀配置 |
| `check_dashscope_api_key` | `bool` | 检查 key 是否存在且非空 |
| `get_git_user_config(path)` | `{name?: string, email?: string}` | 读 repo 当前 git user |
| `set_git_user_config(path, name?, email?)` | `void` | 写 repo git user |

## SettingsView 变更

### 新增/修改 Section

现有 `voice` section 扩展为 `ai` 或新增 `commit` section，包含：

1. **前缀模板**：最多3个文本输入框 + 添加/删除按钮
2. **前缀开关**：toggle 控制是否启用
3. **全局 Git User**：name / email 两个输入框

### Project 配置（已有区域）扩展

每个 project 的编辑/添加弹窗中增加：
- commit_prefix_index：下拉选择全局模板中的第 N 个
- git_user_name：可选覆盖
- git_user_email：可选覆盖

## 命令契约同步

新增命令须在以下位置同步注册：

1. `backend.ts` — IPC 函数封装
2. `backend.ts` — HTTP 路由映射
3. `lib.rs` — `generate_handler!` 宏
4. `http_server/routing.rs` — 路由映射
5. `http_server/handlers/` — handler 实现（或复用命令函数）

运行 `npm run contracts` 验证同步。

## 错误处理

| 场景 | 行为 |
|------|------|
| 无 dashscope key | 不报错，commit message 只填前缀/留空 |
| 模板变量无法解析 | 保留原样（如 `{{unknown-var}}` 不变） |
| git config 写入失败 | 通过环境变量保底，提交不失败 |
| 模板超过3个 | Settings 保存时截断到3个 |
| `commit_prefix_index` 超出范围 | 回退到0（第一个模板） |

## 边界情况

- **空模板**：模板为空字符串时，前缀为空，即"无前缀"选项
- **worktree-name 获取**：linked worktree 的 display_name 从 mapping.json 读取，主 worktree 用目录名
- **browser 模式**：所有命令通过 HTTP 路由暴露，行为一致
- **旧配置迁移**：`#[serde(default)]` 自动处理缺失字段，加载后空模板列表填充默认值
