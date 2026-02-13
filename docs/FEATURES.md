# 功能模块文档

## 1. 工作区管理 (Workspace Management)

### 功能概述
工作区是 Git Worktree Manager 的顶层组织单位，一个工作区可以包含多个项目和多个 worktree。

### 核心功能

#### 1.1 创建工作区
- **新建空工作区**：在指定目录创建新的工作区
- **导入现有目录**：将现有的 Git 仓库目录导入为工作区
- **自动配置**：创建 `.worktree-manager.json` 配置文件

#### 1.2 切换工作区
- 支持在多个工作区之间快速切换
- 保存当前工作区状态
- 自动加载目标工作区配置

#### 1.3 工作区配置
- **基本信息**：名称、路径
- **Worktree 目录**：指定 worktree 存放位置（默认 `worktrees/`）
- **全局链接项**：配置在所有 worktree 中共享的文件/目录
  - 示例：`.claude`, `CLAUDE.md`, `requirement-docs`
- **项目列表**：管理工作区内的项目

### 相关文件
- 前端：`src/components/WelcomeView.tsx`, `src/components/AddWorkspaceModal.tsx`
- 后端：`src-tauri/src/lib.rs` (workspace 相关命令)
- 配置：`~/.config/worktree-manager/global.json`

---

## 2. Worktree 管理

### 功能概述
Worktree 是 Git 的原生功能，允许在同一个仓库中同时检出多个分支。每个 worktree 有独立的工作目录。

### 核心功能

#### 2.1 创建 Worktree
- **选择项目**：可以为一个或多个项目创建 worktree
- **指定分支**：为每个项目指定要检出的分支
- **自动链接**：
  - 链接项目配置的文件夹（如 `node_modules`）
  - 链接工作区全局文件（如 `.claude`）
- **目录结构**：
  ```
  worktrees/
  └── feature-login/
      ├── projects/
      │   ├── frontend/        # git worktree
      │   └── backend/         # git worktree
      ├── .claude -> ../../.claude
      └── CLAUDE.md -> ../../CLAUDE.md
  ```

#### 2.2 查看 Worktree
- **列表视图**：显示所有 worktree
- **状态信息**：
  - 当前分支
  - 未提交更改数量
  - 与基础分支的差异（ahead/behind）
  - 是否合并到测试分支
- **归档状态**：区分活动和已归档的 worktree

#### 2.3 切换 Worktree
- 点击侧边栏切换当前 worktree
- 自动更新详情面板和终端
- 支持工作树锁定（防止多窗口冲突）

#### 2.4 归档 Worktree
- **安全检查**：
  - 检查未提交的更改
  - 检查未推送的提交
  - 检查是否有 Merge Request
- **警告和错误**：
  - 警告：可以归档但需要确认的问题
  - 错误：必须解决才能归档的问题
- **归档操作**：
  - 移动到 `.archived/` 目录
  - 保留所有文件和状态

#### 2.5 恢复 Worktree
- 从归档状态恢复到活动状态
- 恢复所有链接和配置

#### 2.6 删除归档的 Worktree
- 永久删除已归档的 worktree
- 释放磁盘空间

### 相关文件
- 前端：
  - `src/components/WorktreeSidebar.tsx`
  - `src/components/WorktreeDetail.tsx`
  - `src/components/CreateWorktreeModal.tsx`
  - `src/components/ArchiveConfirmationModal.tsx`
- 后端：`src-tauri/src/lib.rs` (worktree 相关命令)

---

## 3. 分享功能 (Share Feature)

### 功能概述
允许通过 HTTP/WebSocket 将工作区分享给远程用户，支持浏览器访问和实时协作。

### 核心功能

#### 3.1 启动分享
- **端口设置**：
  - 首次分享时设置端口（默认 3000）
  - 后续可以点击端口号更改
- **密码生成**：
  - 自动生成 8 位随机密码
  - 包含大小写字母和数字
  - 可以手动更改密码
- **服务启动**：
  - 启动 Axum HTTP 服务器
  - 提供静态文件服务
  - 启用 WebSocket 支持

#### 3.2 分享信息展示
- **本地地址**：`http://localhost:{port}`
- **局域网地址**：`http://{local_ip}:{port}`
- **密码**：显示当前密码，支持复制
- **连接状态**：显示分享是否活动

#### 3.3 停止分享
- 关闭 HTTP 服务器
- 断开所有客户端连接
- 清理会话信息

#### 3.4 分享状态持久化
- 记住上次使用的端口
- 记住上次使用的密码
- 下次启动时自动填充

### 浏览器客户端功能

#### 3.4.1 认证
- 输入密码进行认证
- 会话管理（基于 session ID）
- 速率限制（防止暴力破解）

#### 3.4.2 功能访问
- 查看工作区和 worktree
- 查看项目状态
- 使用终端
- 执行 Git 操作
- 查看分支差异

#### 3.4.3 实时同步
- 终端输入/输出实时同步
- 工作树锁定状态同步
- 客户端连接状态同步

### 相关文件
- 前端：`src/App.tsx` (分享相关 UI)
- 后端：
  - `src-tauri/src/lib.rs` (分享命令)
  - `src-tauri/src/http_server.rs` (HTTP 服务器)

---

## 4. 远程客户端管理

### 功能概述
管理连接到分享服务的远程客户端，支持查看和踢出客户端。

### 核心功能

#### 4.1 查看连接的客户端
- **客户端信息**：
  - 会话 ID
  - IP 地址
  - 连接时间
  - 用户代理（浏览器信息）
- **实时更新**：客户端连接/断开时自动更新列表

#### 4.2 踢出客户端 (Kick)
- **功能**：强制断开指定客户端的连接
- **实现**：
  - 从认证会话中移除
  - 关闭 WebSocket 连接
  - 客户端自动跳转到登录页
- **使用场景**：
  - 移除未授权的访问
  - 清理闲置连接
  - 安全管理

#### 4.3 客户端跟踪
- 记录客户端连接时间
- 跟踪客户端活动
- 自动清理断开的连接

### 相关文件
- 前端：`src/App.tsx` (客户端列表和 kick 按钮)
- 后端：
  - `src-tauri/src/lib.rs` (`kick_client` 命令)
  - `src-tauri/src/http_server.rs` (客户端管理)

---

## 5. Git 操作 (Git Operations)

### 功能概述
集成常用的 Git 操作，简化分支管理和代码合并流程。

### 核心功能

#### 5.1 同步基础分支 (Sync with Base Branch)
- **功能**：将基础分支的最新代码合并到当前分支
- **步骤**：
  1. `git fetch origin`
  2. `git merge origin/{base_branch}` 或 `git rebase origin/{base_branch}`
- **使用场景**：保持分支与主分支同步

#### 5.2 合并到测试分支 (Merge to Test Branch)
- **功能**：将当前分支合并到测试分支
- **步骤**：
  1. 切换到测试分支
  2. `git merge {current_branch}`
  3. `git push origin {test_branch}`
- **使用场景**：将功能分支部署到测试环境

#### 5.3 创建 Pull Request
- **功能**：在 Git 托管平台创建 PR/MR
- **支持平台**：
  - GitHub（使用 `gh` CLI）
  - GitLab（使用 `glab` CLI）
- **输入**：
  - PR 标题
  - PR 描述（可选）
- **输出**：PR/MR 的 URL

#### 5.4 查看分支差异统计
- **功能**：显示当前分支与基础分支的差异
- **信息**：
  - 新增文件数
  - 修改文件数
  - 删除文件数
  - 新增行数
  - 删除行数
- **实现**：使用 `git diff --stat`

### Git 状态信息

#### 5.5 分支状态
- **当前分支**：显示当前检出的分支
- **未提交更改**：显示未提交的文件数量
- **未推送提交**：显示未推送到远程的提交数量
- **合并状态**：是否已合并到测试分支
- **Ahead/Behind**：与基础分支的差异

#### 5.6 Merge Request 检测
- 检查当前分支是否有 MR/PR
- 显示 MR/PR 状态

### 相关文件
- 前端：`src/components/GitOperations.tsx`
- 后端：
  - `src-tauri/src/lib.rs` (Git 命令)
  - `src-tauri/src/git_ops.rs` (Git 操作实现)

---

## 6. 终端管理 (Terminal Management)

### 功能概述
为每个 worktree 提供独立的终端会话，支持多标签页和实时交互。

### 核心功能

#### 6.1 创建终端
- **自动创建**：选择 worktree 时自动创建终端
- **工作目录**：
  - 主终端：worktree 根目录
  - 项目终端：项目目录
- **Shell**：使用系统默认 shell（bash/zsh/powershell）

#### 6.2 终端标签页
- **主标签页**：worktree 根目录
- **项目标签页**：每个项目一个标签页
- **标签管理**：
  - 切换标签页
  - 关闭标签页
  - 重命名标签页

#### 6.3 终端交互
- **输入**：键盘输入实时发送到后端
- **输出**：后端输出实时显示在终端
- **特殊键**：支持 Ctrl+C、Ctrl+D 等控制键
- **复制粘贴**：支持终端内容复制和粘贴

#### 6.4 终端调整
- **大小调整**：自动适应窗口大小
- **全屏模式**：支持终端全屏显示
- **字体设置**：可配置字体大小和样式

#### 6.5 终端会话管理
- **会话持久化**：终端会话在后台保持运行
- **重连**：切换 worktree 后重新连接到对应终端
- **清理**：关闭 worktree 时清理终端会话

### 技术实现

#### 前端
- **xterm.js**：终端模拟器
- **xterm-addon-fit**：自动调整大小
- **xterm-addon-web-links**：支持链接点击

#### 后端
- **portable-pty**：跨平台伪终端
- **PTY Manager**：管理多个终端实例
- **WebSocket**：实时双向通信

### 相关文件
- 前端：
  - `src/components/TerminalPanel.tsx`
  - `src/components/Terminal.tsx`
- 后端：
  - `src-tauri/src/pty_manager.rs`
  - `src-tauri/src/lib.rs` (终端命令)

---

## 7. NGROK 隧道 (NGROK Tunnel)

### 功能概述
使用 NGROK 将本地分享服务暴露到公网，实现远程访问。

### 核心功能

#### 7.1 配置 NGROK Token
- **设置 Token**：输入 NGROK 认证 Token
- **保存 Token**：Token 保存到配置文件
- **验证 Token**：启动隧道前验证 Token 有效性

#### 7.2 启动 NGROK 隧道
- **前置条件**：
  - 必须先启动分享服务
  - 必须配置 NGROK Token
- **隧道创建**：
  - 连接到 NGROK 服务
  - 创建 HTTP 隧道
  - 转发到本地端口
- **公网地址**：生成 HTTPS 公网访问地址

#### 7.3 NGROK 信息展示
- **隧道状态**：显示隧道是否活动
- **公网地址**：显示 NGROK 生成的 URL
- **复制功能**：一键复制公网地址
- **始终展示**：即使未配置 Token 也显示 NGROK 区域

#### 7.4 停止 NGROK 隧道
- 关闭隧道连接
- 释放资源
- 更新状态显示

#### 7.5 优化的用户体验
- **未配置提示**：未填写 Token 时点击启动会弹窗提示
- **状态同步**：隧道状态实时更新
- **错误处理**：显示详细的错误信息

### 使用场景
- 远程演示
- 远程协作
- 临时分享
- 跨网络访问

### 相关文件
- 前端：`src/App.tsx` (NGROK UI)
- 后端：`src-tauri/src/lib.rs` (NGROK 命令)

---

## 8. 项目管理 (Project Management)

### 功能概述
管理工作区内的项目，每个项目对应一个 Git 仓库。

### 核心功能

#### 8.1 添加项目
- **克隆仓库**：
  - 支持 GitHub 简写（`owner/repo`）
  - 支持 SSH URL
  - 支持 HTTPS URL
- **配置项目**：
  - 项目名称
  - 基础分支（base branch）
  - 测试分支（test branch）
  - 合并策略（merge/rebase）
  - 链接文件夹

#### 8.2 智能扫描
- **自动检测**：扫描项目目录，识别可链接的文件夹
- **推荐项**：
  - `node_modules`（Node.js）
  - `.next`（Next.js）
  - `vendor`（PHP/Go）
  - `target`（Rust）
  - `build`、`dist`（构建产物）
- **大小显示**：显示每个文件夹的大小
- **自定义**：支持添加自定义路径

#### 8.3 项目配置
- **基础分支**：主开发分支（如 `main`、`master`）
- **测试分支**：测试环境分支（如 `test`、`staging`）
- **合并策略**：
  - `merge`：使用 `git merge`
  - `rebase`：使用 `git rebase`
- **链接文件夹**：配置要在 worktree 间共享的文件夹

#### 8.4 添加项目到 Worktree
- 为现有 worktree 添加新项目
- 指定分支
- 自动创建 git worktree
- 自动链接配置的文件夹

### 相关文件
- 前端：
  - `src/components/AddProjectModal.tsx`
  - `src/components/AddProjectToWorktreeModal.tsx`
- 后端：`src-tauri/src/lib.rs` (项目相关命令)

---

## 9. IDE 集成 (IDE Integration)

### 功能概述
快速用常用 IDE 打开 worktree 或项目。

### 支持的 IDE

#### 9.1 Visual Studio Code
- **命令**：`code {path}`
- **图标**：VS Code 图标
- **功能**：打开 worktree 根目录或项目目录

#### 9.2 Cursor
- **命令**：`cursor {path}`
- **图标**：Cursor 图标
- **功能**：打开 worktree 根目录或项目目录

#### 9.3 IntelliJ IDEA
- **命令**：`idea {path}`
- **图标**：IDEA 图标
- **功能**：打开项目目录

### 使用方式
- **下拉菜单**：点击编辑器图标选择 IDE
- **快捷操作**：右键菜单快速打开
- **多项目支持**：可以分别打开不同项目

### 相关文件
- 前端：`src/components/WorktreeDetail.tsx`
- 后端：`src-tauri/src/lib.rs` (`open_editor` 命令)

---

## 10. 设置和配置 (Settings)

### 功能概述
管理应用的全局设置和工作区配置。

### 核心功能

#### 10.1 工作区设置
- **名称**：修改工作区名称
- **Worktree 目录**：配置 worktree 存放位置
- **全局链接项**：配置共享文件/目录列表

#### 10.2 项目设置
- **基础分支**：修改项目的基础分支
- **测试分支**：修改项目的测试分支
- **合并策略**：选择 merge 或 rebase
- **链接文件夹**：管理链接的文件夹列表

#### 10.3 应用设置
- **主题**：切换明暗主题（未来功能）
- **语言**：切换界面语言（未来功能）
- **更新**：检查应用更新

### 相关文件
- 前端：`src/components/SettingsView.tsx`
- 后端：`src-tauri/src/lib.rs` (配置相关命令)

---

## 11. 应用更新 (Auto Update)

### 功能概述
自动检查和安装应用更新。

### 核心功能

#### 11.1 检查更新
- **自动检查**：启动时自动检查更新
- **手动检查**：设置页面手动检查
- **版本比较**：比较当前版本和最新版本

#### 11.2 下载更新
- **后台下载**：在后台下载更新包
- **进度显示**：显示下载进度
- **断点续传**：支持下载中断后继续

#### 11.3 安装更新
- **提示安装**：下载完成后提示用户安装
- **重启应用**：安装更新并重启应用
- **回滚**：安装失败时回滚到旧版本

### 相关文件
- 前端：
  - `src/components/UpdaterDialogs.tsx`
  - `src/hooks/useUpdater.ts`
  - `src/utils/updater.ts`
- 后端：Tauri 内置更新器

---

## 功能矩阵

| 功能 | 桌面模式 | 浏览器模式 | 说明 |
|------|---------|-----------|------|
| 工作区管理 | ✅ | ✅ | 完全支持 |
| Worktree 管理 | ✅ | ✅ | 完全支持 |
| Git 操作 | ✅ | ✅ | 完全支持 |
| 终端 | ✅ | ✅ | 完全支持 |
| IDE 集成 | ✅ | ❌ | 仅桌面支持 |
| 分享功能 | ✅ | ❌ | 仅桌面支持 |
| NGROK 隧道 | ✅ | ❌ | 仅桌面支持 |
| 应用更新 | ✅ | ❌ | 仅桌面支持 |
| 文件系统访问 | ✅ | ⚠️ | 浏览器受限 |
