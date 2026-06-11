<div align="center">

<img src="docs/icons/app-icon.svg" width="128" height="128" alt="Worktree Manager">

# Worktree Manager

**Git Worktree 可视化管理工具**

多分支并行开发，多仓库联动，告别 `stash`、`clone` 和上下文切换的痛苦。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/guoyongchang/worktree-manager)](https://github.com/guoyongchang/worktree-manager/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/guoyongchang/worktree-manager/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)

<p align="center">
  <a href="#-快速开始">快速开始</a> •
  <a href="#-核心功能">核心功能</a> •
  <a href="#-截图">截图</a> •
  <a href="#-常见问题">FAQ</a> •
  <a href="README.md">English</a>
</p>

[**下载**](https://github.com/guoyongchang/worktree-manager/releases) |
[文档](https://guoyongchang.github.io/worktree-manager/) |
[MCP 集成](docs/MCP.md)

</div>

---

## 为什么需要 Worktree Manager？

### 线上着火，但你手里的活还没提交

你正在 `feature/checkout-v2` 上重构结算流程，改了十几个文件，`npm run dev` 跑着热更新。这时候 Slack 弹出告警：线上支付回调 500 了。

**没有 Worktree Manager** — `git stash` → 切分支 → `npm install`（依赖版本不同，得重装） → 等构建 → 修 bug → 切回来 → `git stash pop` → 祈祷没冲突 → 重启 dev server。**15 分钟起步。**

**有 Worktree Manager** — 点「新建」，输入 `hotfix-payment`，完成。Feature 分支 dev server 还在跑，`node_modules` 通过 symlink 共享，秒级就绪。**切换成本 30 秒。**

### 多仓库工作区 & 并行 AI 开发

将相关仓库组成一个**工作区**，新建 Worktree 时所有项目一起创建 `git worktree`。每个 Worktree 拥有独立终端 —— 可以同时在不同分支上运行 Claude Code、Codex 或 Cursor，互不冲突。

<p align="center">
<img src="docs/gif/card1-multi-repo.gif" width="680" alt="多仓库工作区 — 一键切换所有仓库，每个 worktree 运行独立 AI 代理">
</p>

### 零成本上下文切换

开发到一半突发 P0？新建 `hotfix-payment` Worktree → AI 辅助修复 → 合并到 main → 归档 → 切回去。**未提交的代码、终端输出、dev server —— 一切都还在。**

<p align="center">
<img src="docs/gif/card2-hotfix-story.gif" width="680" alt="零成本上下文切换 — hotfix 不丢失任何工作">
</p>

### 前后端联调，分支对不上就炸

前后端分仓，做「会员体系」时两个仓库都要切到 `feature/membership`。同事让你看一个 `feature/search` 的问题，你切了前端忘了切后端 —— 白屏、404，排查半天发现是分支没对齐。

**用 Worktree Manager** — 一个 worktree 绑定多个仓库，切换 worktree 就是切换整套环境，不存在「只切了一半」。

---

## 📸 截图

| 主界面 | 创建 Worktree |
| :---: | :---: |
| ![主界面](docs/screenshots/main-view.png) | ![创建 Worktree](docs/screenshots/new-worktree.png) |

| 终端 & AI 编程 | 浏览器远程访问 |
| :---: | :---: |
| ![终端](docs/screenshots/use-example-1.png) | ![远程访问](docs/screenshots/remote-access.png) |

| 语音输入 & AI 精炼 |
| :---: |
| ![语音输入](docs/screenshots/voice-and-refine.png) |

---

## 🚀 快速开始

### 下载

| 平台 | 下载 |
|------|------|
| macOS | [`.dmg`](https://github.com/guoyongchang/worktree-manager/releases/latest) |
| Windows | [`-setup.exe`](https://github.com/guoyongchang/worktree-manager/releases/latest) |
| Linux | [`.AppImage` / `.deb`](https://github.com/guoyongchang/worktree-manager/releases/latest) |

> **唯一要求：Git 2.0+。** 运行时不需要 Node.js 或 Rust。

### 三步上手

1. **创建工作区** — 导入你的项目目录，或新建一个 Workspace
2. **添加项目** — 通过 GitHub 简写（`owner/repo`）、SSH 或 HTTPS 添加仓库
3. **新建 Worktree** — 点击「+」，输入分支名，选择项目，开始开发

就这么简单。Worktree 创建后自动链接依赖、配置终端，开箱即用。

---

## ✨ 核心功能

### 基础能力

| 功能 | 说明 |
|------|------|
| 🌿 **多分支并行** | 同时在多个分支上工作，互不干扰，共享 `.git` 数据 |
| 📦 **多仓库工作区** | 将前端 + 后端 + 公共库组成工作区，切换 worktree 所有仓库同步切换 |
| 🔗 **智能 Symlink** | 自动链接 `node_modules`、`.next`、`vendor`、`target`，零磁盘浪费 |
| 🏷️ **标签分组** | 按团队、领域或技术栈打标签，创建 worktree 时按标签筛选 |

### Git 操作

| 功能 | 说明 |
|------|------|
| 🔄 **一键操作** | 同步 base、合并到 test、拉取、推送，全在界面完成 |
| 📊 **分支洞察** | 一眼看到领先/落后多少个 commit |
| ⚡ **批量触发** | 一键对 worktree 内所有项目执行操作 |
| 📝 **AI 提交信息** | 使用 Qwen AI 自动生成 commit message（可选） |

### 终端 & 远程

| 功能 | 说明 |
|------|------|
| 💻 **内置终端** | 完整终端模拟器（xterm.js + PTY），支持 Shell 集成和搜索 |
| 🎤 **语音输入** | 对着终端说话即可输入，Dashscope ASR + AI 文本精炼 |
| 🌐 **浏览器远程** | 通过网络分享工作区，密码保护 |
| 🔒 **ngrok 穿透** | 可选 ngrok 隧道，无需端口映射即可公网访问 |

### 集成

| 功能 | 说明 |
|------|------|
| 🖥️ **IDE 集成** | 一键用 VS Code、Cursor 或 IntelliJ IDEA 打开 |
| 🤖 **AI 就绪 (MCP)** | 内置 [MCP 服务器](docs/MCP.md)，让 Claude Code、Cursor、Codex 通过自然语言管理 worktree |
| 📁 **安全归档** | 归档前检查未提交更改和运行中的进程，随时一键恢复 |

---

## ❓ 常见问题

<details>
<summary><strong>什么是 Git worktree？</strong></summary>

Git worktree 可以将同一仓库的多个分支检出到独立目录，共享 `.git` 数据。不需要克隆多份仓库，不占额外磁盘空间。[了解更多](https://git-scm.com/docs/git-worktree)

</details>

<details>
<summary><strong>Symlink 是怎么工作的？</strong></summary>

创建 worktree 时，Worktree Manager 会自动为你指定的目录（如 `node_modules`、`.next`、`target`）创建符号链接，指向主项目的对应目录。这样你永远不需要重新安装依赖。可以按项目单独配置需要链接的目录。

</details>

<details>
<summary><strong>只有一个仓库也能用吗？</strong></summary>

当然。多仓库工作区是亮点功能，但单仓库一样好用。

</details>

<details>
<summary><strong>浏览器远程访问需要在远程机器装东西吗？</strong></summary>

不需要。远程机器只需要一个现代浏览器。终端、文件浏览、git 操作、worktree 管理全在网页完成。

</details>

<details>
<summary><strong>通过浏览器分享安全吗？</strong></summary>

安全。浏览器访问采用 challenge-response 认证（不在网络上传输明文密码）。可以限制仅局域网访问，或使用 ngrok 安全隧道。

</details>

<details>
<summary><strong>MCP 集成能做什么？</strong></summary>

内置 [Model Context Protocol](docs/MCP.md) 服务器，让 AI 编程助手（Claude Code、Cursor、Codex）通过自然语言创建 worktree、查看状态、执行 git 操作 —— 不用离开 AI 聊天窗口。详见 [MCP 文档](docs/MCP.md)。

</details>

---

## 📂 工作原理

<details>
<summary>工作区目录结构</summary>

```
workspace/
├── .worktree-manager.json        # 工作区配置
├── projects/                     # 主仓库（base 分支）
│   ├── frontend/
│   └── backend/
└── worktrees/                    # Worktree 目录
    ├── feature-checkout-v2/
    │   ├── projects/
    │   │   ├── frontend/         # ← git worktree（独立分支）
    │   │   │   └── node_modules  # ← symlink 到主仓库
    │   │   └── backend/
    │   ├── .claude -> ../../.claude       # 共享文件
    │   └── CLAUDE.md -> ../../CLAUDE.md
    └── hotfix-payment/
        └── ...
```

共享文件（`.claude`、`CLAUDE.md`、配置文件）自动 symlink 到所有 worktree，AI 助手和工具配置始终保持同步。

</details>

<details>
<summary>配置文件示例（<code>.worktree-manager.json</code>）</summary>

```jsonc
{
  "name": "我的项目",
  "worktrees_dir": "worktrees",
  "linked_workspace_items": [".claude", "CLAUDE.md"],
  "tags": [
    { "id": "fe", "name": "前端", "color": "#3B82F6" },
    { "id": "be", "name": "后端", "color": "#10B981" }
  ],
  "projects": [
    {
      "name": "web-app",
      "base_branch": "main",
      "test_branch": "test",
      "merge_strategy": "merge",
      "linked_folders": ["node_modules", ".next"],
      "tags": ["fe"]
    }
  ]
}
```

</details>

---

## 🔧 从源码构建

<details>
<summary>面向贡献者和开发者</summary>

**环境要求：** Node.js 20+、Rust 1.70+（[安装](https://rustup.rs)）、Git 2.0+

```bash
git clone https://github.com/guoyongchang/worktree-manager.git
cd worktree-manager
npm install

# 开发模式
npm run build && npm run tauri dev

# 生产构建
npm run tauri build

# 验证命令契约（IPC ↔ HTTP 同步）
npm run contracts
```

**技术栈：** Tauri 2 · React 19 · TypeScript 5 · Tailwind CSS 4 · Rust (axum, git2, tokio) · xterm.js

详见 [TESTING.md](docs/TESTING.md) 了解测试策略。

</details>

---

## 参与贡献

欢迎贡献！请先开一个 issue 讨论你想改的内容。

## 许可证

[MIT](LICENSE)

---

<div align="center">

**如果 Worktree Manager 为你节省了时间，请给个 ⭐！**

[报告 Bug](https://github.com/guoyongchang/worktree-manager/issues) ·
[功能建议](https://github.com/guoyongchang/worktree-manager/issues) ·
[文档](https://guoyongchang.github.io/worktree-manager/)

</div>
