# Git Worktree Manager

<div align="center">

<img src="src-tauri/icons/app-icon.svg" width="128" height="128" alt="Worktree Manager">

**一个优雅的 Git Worktree 可视化管理工具**

让多分支并行开发变得简单高效

</div>

---

## 为什么需要这个工具？

作为开发者，你一定遇到过这些烦恼：

> **场景一：紧急修 Bug**
>
> 你正在 `feature/new-page` 分支上开发新页面，写到一半，产品经理跑过来说线上有个紧急 bug。你不得不 `git stash`，切换到 `hotfix` 分支，修完再切回来，结果发现 `node_modules` 要重新装一遍...

> **场景二：多任务并行**
>
> 你同时负责两个需求，一个在 `feature/a`，一个在 `feature/b`。来回切换分支，每次都要等 `npm install`、等构建缓存重建，一天下来光等编译就花了一小时。

> **场景三：代码对比**
>
> 你想对比两个分支的运行效果，只能来回切换，或者 clone 两份代码。磁盘空间翻倍不说，还得维护两套环境。

**Git Worktree Manager 就是为了解决这些问题！**

它利用 Git 原生的 [worktree](https://git-scm.com/docs/git-worktree) 功能，让你在**同一个仓库**中同时检出多个分支，每个分支有**独立的工作目录**，共享 `.git` 数据，还能自动链接 `node_modules` 等大文件夹，**节省磁盘空间**。

## 核心功能

### 多分支并行工作
一个项目同时打开多个分支，互不干扰。不用 `stash`，不用 `clone` 多份。

### 智能文件夹链接
创建 worktree 时自动链接 `node_modules`、`.next`、`vendor` 等构建产物，避免重复安装依赖。支持自定义链接路径。

### Workspace 全局文件共享
`.claude`、`CLAUDE.md`、`requirement-docs` 等文件可以配置为全局链接，在所有 worktree 中共享。

### 分支状态一目了然
实时显示每个分支的提交数、未提交更改、是否合并到测试分支等信息。

### 快速打开 IDE
一键用 VS Code、Cursor 或 IntelliJ IDEA 打开任意 worktree。

### 内置终端
每个 worktree 有独立的终端会话，无需在多个窗口之间切换。

### 安全归档
完成开发后归档 worktree，归档前自动检查未提交和未推送的代码，防止丢失。

## 快速开始

### 环境要求

- **Node.js** 20+
- **Rust** 1.70+（[安装指南](https://rustup.rs)）
- **Git** 2.0+

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/guoyongchang/worktree-manager.git
cd worktree-manager

# 安装依赖
npm install

# 开发模式运行
npm run tauri dev

# 构建生产版本
npm run tauri build
```

### 三步上手

**1. 创建工作区** — 启动后导入你的项目目录，或新建一个 Workspace

**2. 新建 Worktree** — 点击侧边栏的 "+" 按钮，输入分支名，选择项目，一键创建

**3. 开始开发** — 在列表中切换 worktree，用你喜欢的 IDE 打开，各分支互不干扰

## 添加项目

主工作区中点击 "添加项目"，支持三种方式：

| 方式 | 格式 | 示例 |
|------|------|------|
| GitHub 简写 | `owner/repo` | `facebook/react` |
| SSH | `git@host:owner/repo.git` | `git@github.com:facebook/react.git` |
| HTTPS | `https://host/owner/repo.git` | `https://github.com/facebook/react.git` |

添加时可以选择要链接的文件夹（如 `node_modules`、`.next`），也可以添加自定义路径。

## 配置文件

### 全局配置 `~/.config/worktree-manager/global.json`

```json
{
  "workspaces": [
    { "name": "我的项目", "path": "/path/to/workspace" }
  ],
  "current_workspace": "/path/to/workspace"
}
```

### 工作区配置 `{workspace}/.worktree-manager.json`

```json
{
  "name": "我的项目",
  "worktrees_dir": "worktrees",
  "linked_workspace_items": [".claude", "CLAUDE.md", "requirement-docs"],
  "projects": [
    {
      "name": "frontend",
      "base_branch": "main",
      "test_branch": "test",
      "merge_strategy": "merge",
      "linked_folders": ["node_modules", ".next"]
    }
  ]
}
```

## 目录结构

```
workspace/
├── .worktree-manager.json    # 工作区配置
├── projects/                 # 主仓库（main 分支）
│   ├── frontend/
│   └── backend/
├── worktrees/                # Worktree 目录
│   ├── feature-login/
│   │   ├── projects/
│   │   │   ├── frontend/     # git worktree（独立分支）
│   │   │   └── backend/
│   │   ├── .claude -> ../../.claude  # 软链接
│   │   └── CLAUDE.md -> ../../CLAUDE.md
│   └── hotfix-bug/
│       └── ...
├── .claude/
└── CLAUDE.md
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Tauri 2 |
| 前端 | React 19 + TypeScript |
| 样式 | Tailwind CSS 4 |
| UI 组件 | Radix UI |
| 构建 | Vite 7 |
| 后端 | Rust |
| 终端 | xterm.js + portable-pty |

## 许可证

[MIT License](LICENSE)
