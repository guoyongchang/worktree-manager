# Git Worktree Manager - 项目概述

## 项目简介

Git Worktree Manager 是一个优雅的 Git Worktree 可视化管理工具，旨在让多分支并行开发变得简单高效。它利用 Git 原生的 worktree 功能，让开发者在同一个仓库中同时检出多个分支，每个分支拥有独立的工作目录，共享 `.git` 数据，并能自动链接 `node_modules` 等大文件夹以节省磁盘空间。

## 项目目标

- **提升开发效率**：消除频繁切换分支带来的等待时间（重新安装依赖、重建缓存等）
- **支持多任务并行**：同时处理多个需求或紧急修复，互不干扰
- **节省磁盘空间**：通过智能文件夹链接，避免重复存储依赖和构建产物
- **简化工作流程**：提供直观的可视化界面，降低 Git worktree 的使用门槛
- **远程协作**：支持通过 HTTP/WebSocket 分享工作区，实现远程访问和协作

## 技术栈

### 核心框架
- **Tauri 2**：跨平台桌面应用框架，提供原生性能和安全性
- **Rust**：后端语言，负责系统操作、Git 管理、HTTP 服务等
- **React 19**：前端框架，构建响应式用户界面
- **TypeScript**：类型安全的 JavaScript 超集

### 前端技术
- **Vite 7**：快速的前端构建工具
- **Tailwind CSS 4**：实用优先的 CSS 框架
- **Radix UI**：无样式的可访问 UI 组件库
- **xterm.js**：终端模拟器，提供内置终端功能
- **Lucide React**：图标库

### 后端技术
- **git2-rs**：Git 操作的 Rust 绑定
- **Axum**：高性能异步 Web 框架
- **Tokio**：异步运行时
- **portable-pty**：跨平台伪终端支持
- **ngrok**：内网穿透服务，用于远程访问

## 项目架构

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri Desktop App                     │
├─────────────────────────────────────────────────────────┤
│  Frontend (React)          │  Backend (Rust)             │
│  ┌──────────────────────┐  │  ┌───────────────────────┐ │
│  │ UI Components        │  │  │ Tauri Commands        │ │
│  │ - WorktreeSidebar    │◄─┼─►│ - Workspace Mgmt      │ │
│  │ - WorktreeDetail     │  │  │ - Worktree Ops        │ │
│  │ - TerminalPanel      │  │  │ - Git Operations      │ │
│  │ - GitOperations      │  │  │ - Terminal (PTY)      │ │
│  └──────────────────────┘  │  └───────────────────────┘ │
│  ┌──────────────────────┐  │  ┌───────────────────────┐ │
│  │ State Management     │  │  │ HTTP Server (Axum)    │ │
│  │ - useWorkspace       │  │  │ - REST API            │ │
│  │ - useTerminal        │  │  │ - WebSocket           │ │
│  └──────────────────────┘  │  │ - Static Files        │ │
│                             │  └───────────────────────┘ │
└─────────────────────────────┴─────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
              ┌─────▼─────┐         ┌──────▼──────┐
              │  Browser  │         │   NGROK     │
              │  Clients  │         │   Tunnel    │
              └───────────┘         └─────────────┘
```

### 通信机制

1. **Tauri IPC**：前端与后端之间的主要通信方式
   - 使用 `invoke()` 调用 Rust 命令
   - 使用 `listen()` 接收后端事件

2. **HTTP API**：用于浏览器客户端访问
   - RESTful API 端点
   - 支持密码认证
   - 会话管理

3. **WebSocket**：实时双向通信
   - 终端输入/输出
   - 状态同步
   - 客户端管理

4. **NGROK Tunnel**：内网穿透
   - 将本地服务暴露到公网
   - 提供 HTTPS 访问

## 核心特性

### 1. 多分支并行工作
- 一个项目同时打开多个分支，互不干扰
- 无需 `git stash` 或克隆多份代码
- 每个 worktree 有独立的工作目录

### 2. 智能文件夹链接
- 自动链接 `node_modules`、`.next`、`vendor` 等构建产物
- 避免重复安装依赖，节省磁盘空间
- 支持自定义链接路径

### 3. Workspace 全局文件共享
- `.claude`、`CLAUDE.md`、`requirement-docs` 等文件全局共享
- 在所有 worktree 中保持一致

### 4. 分支状态实时监控
- 显示提交数、未提交更改
- 检查是否合并到测试分支
- 显示与基础分支的差异

### 5. Git 操作集成
- 同步基础分支（fetch + merge/rebase）
- 合并到测试分支
- 创建 Pull Request
- 查看分支差异统计

### 6. 快速打开 IDE
- 一键用 VS Code、Cursor 或 IntelliJ IDEA 打开
- 支持自定义编辑器

### 7. 内置终端
- 每个 worktree 独立终端会话
- 支持多标签页
- 基于 xterm.js 的完整终端体验

### 8. 远程分享功能
- 通过 HTTP 分享工作区
- 密码保护
- 支持多客户端连接
- 实时同步终端和状态
- 支持踢出客户端

### 9. NGROK 隧道
- 一键启动内网穿透
- 自动生成公网访问地址
- 支持自定义 NGROK Token

### 10. 安全归档
- 归档前自动检查未提交和未推送的代码
- 防止代码丢失
- 支持恢复已归档的 worktree

## 版本信息

- **当前版本**：0.1.1
- **许可证**：MIT License
- **仓库地址**：https://github.com/guoyongchang/worktree-manager
