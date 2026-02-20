# Git Worktree Manager

<div align="center">

<img src="src-tauri/icons/app-icon.svg" width="128" height="128" alt="Worktree Manager">

**一个优雅的 Git Worktree 可视化管理工具**

让多分支并行开发变得简单高效

</div>

---

## 为什么需要这个工具？

> **场景一：线上着火，但你手里的活还没提交**
>
> 你正在 `feature/checkout-v2` 上重构结算流程，改了十几个文件，`npm run dev` 跑着热更新。这时候 Slack 弹出告警：线上支付回调 500 了。你得马上修。
>
> 传统做法：`git stash` → 切到 `hotfix` → `npm install`（依赖版本不一样，得重装）→ 修完推上去 → 切回来 → `git stash pop` → 祈祷没冲突 → 重启 dev server 等构建缓存重建。整个流程 15 分钟起步，而线上还在报错。
>
> **用 Worktree Manager**：新建一个 `hotfix-payment` worktree，`node_modules` 自动通过 symlink 共享，秒级就绪。你的 `feature/checkout-v2` dev server 还在跑，改到一半的代码一行不用动。修完线上问题，归档 hotfix worktree，整个过程不超过 30 秒切换成本。

> **场景二：前后端联调，分支对不上就炸**
>
> 你的项目是前后端分仓：`web` 和 `api`。做「会员体系」需求时，两个仓库都要切到 `feature/membership` 分支。但同事让你帮忙看一个 `feature/search` 的问题，你切了前端分支忘了切后端——页面白屏，接口 404，排查半天才发现是分支没对齐。
>
> **用 Worktree Manager**：一个 worktree 绑定多个项目仓库。创建 `membership` worktree 时，`web` 和 `api` 同时检出到对应分支。切换 worktree 就是切换整套工作环境，不存在「只切了一半」的问题。

> **场景三：提测合并全靠命令行肌肉记忆**
>
> 需求开发完了，要合并到 `test` 分支给 QA 验证。你每次都得：`git checkout test` → `git pull` → `git merge feature/xxx` → 解决冲突 → `git push` → `git checkout feature/xxx` 切回来。一天提测三四个需求，这套操作重复到麻木，偶尔还会忘记切回来就在 `test` 分支上继续开发。
>
> **用 Worktree Manager**：每个项目卡片下方直接有「合并到 test」「同步 base」「推送」按钮，一键操作，不需要离开当前分支。分支状态（领先/落后几个 commit、是否已合并 test）实时显示，一目了然。

> **场景四：出差在外，想看一眼公司机器上的代码**
>
> 你的开发机在公司内网，出差时想看一下代码运行状态，或者在终端里执行几条命令。传统方案要么 SSH 隧道（折腾），要么 VPN + 远程桌面（卡顿）。
>
> **用 Worktree Manager**：开启内置分享功能，局域网或通过 ngrok 生成公网链接。在任意浏览器中打开，密码验证后即可查看工作区状态、使用内置终端，不需要安装任何客户端。

**Git Worktree Manager** 基于 Git 原生的 [worktree](https://git-scm.com/docs/git-worktree) 能力构建，让你在**同一个仓库**中同时检出多个分支到**独立目录**，共享 `.git` 数据。配合自动 symlink `node_modules` 等大文件夹，**零成本切换**，**零额外磁盘占用**。

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
