# CLAUDE.md 文档体系重构设计

## 目标

基于 harness 渐进式披露思想，重构项目文档体系：
1. 减少 Claude 每次对话的 token 消耗（从 ~3K tokens 降到 ~1K）
2. 形成人类可读的 Obsidian 知识库
3. 对核心逻辑（终端状态、双模式通信）重点描述

## 现状问题

- `CLAUDE.md` 190 行单体文件，每次对话全量加载
- `docs/` 下 6 个文件共 3000+ 行，与 CLAUDE.md 大量重复
- 无层级结构，Claude 无论做什么任务都消耗全量 token
- 人类开发者也缺乏结构化的知识浏览入口

## 三层架构设计

```
Layer 1: CLAUDE.md (~40行)     ← 每次对话自动加载
    ↓ @see 指引按需加载
Layer 2: docs/claude/ (~3文件)  ← Claude 编码时按需读取
    ↓ 完整内容
Layer 3: Obsidian Vault (~20文件) ← 人类在 Obsidian 中浏览
```

### Layer 1 — CLAUDE.md（自动加载，~40行）

精简到只包含：
- 项目一句话定位 + 技术栈（1行）
- 开发命令（1行）
- 文件结构（仅文件名，无注释，6行）
- **核心约束/陷阱**（~20行）— Claude 容易犯错的关键规则
- 按需参考指引（5行）

#### 核心约束覆盖范围

1. **终端状态分离** — activatedTerminals vs mountedTerminals 必须分离，卸载触发 pty_close
2. **Git 操作混用规则** — 读取用 git2，写入用 Command
3. **双模式命令同步** — 新增命令须同步三处 + npm run contracts 验证
4. **性能约束** — 两阶段加载，loading overlay 不用 early return

#### 删除内容（可从代码或按需文件获取）

- 完整文件树注释（Claude 可用 Glob）
- 全局状态表（移到 docs/claude/backend-state.md）
- 61 个命令分类列表（移到 docs/claude/backend-state.md）
- 配置文件格式（可读代码）
- 目录约定详情（移到 vault）
- 数据类型定义（可读 types.ts）
- 多窗口同步详情（移到 docs/claude/terminal-architecture.md）
- HTTP API 详情（移到 docs/claude/dual-mode.md）

### Layer 2 — docs/claude/（按需读取）

仅 3 个文件，Claude 在需要修改相关代码时按路径读取：

#### docs/claude/backend-state.md
- 8 个全局状态变量表格（变量名、类型、用途）
- 61 个 Tauri commands 按领域分类一览
- 新增命令时的同步步骤

#### docs/claude/terminal-architecture.md
- activatedTerminals / mountedTerminals / terminalVisible 完整职责表
- PTY 会话生命周期流程
- 桌面端轮询 vs 浏览器端 WebSocket
- 多窗口同步机制（broadcast channel + 序列号）
- 会话 ID 格式：`pty-{path-with-dashes}`，复制标签用 `path#timestamp`
- 归档时清理流程

#### docs/claude/dual-mode.md
- callBackend 路由逻辑（环境检测 → IPC/HTTP）
- HTTP 路由模式：POST /api/{command}
- 认证：x-session-id header, 限流规则
- WebSocket：/ws?session_id=xxx 消息类型
- 安全约束：localhost-only（terminal/editor/finder）、CSP headers
- 常量时间比较防时序攻击

#### 保留不变
- docs/COMMAND_CONTRACTS.md — 命令契约验证脚本说明
- docs/generated/ — 自动生成的契约文档
- docs/superpowers/ — 设计规范和实现计划

#### 删除
- docs/ARCHITECTURE.md（内容迁移到 vault）
- docs/FEATURES.md（内容迁移到 vault）
- docs/API.md（内容迁移到 vault）
- docs/DEVELOPMENT.md（内容迁移到 vault）
- docs/PROJECT_OVERVIEW.md（内容迁移到 vault）
- docs/NEW_FEATURES.md（内容迁移到 vault）

### Layer 3 — Obsidian Vault

#### 位置
`/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/`

#### 目录结构

```
worktree-manager/
├── CLAUDE.md                         # 总索引 MOC（渐进式入口）
├── architecture/
│   ├── overview.md                   # 分层架构图 + 技术栈总览
│   ├── dual-mode-communication.md    # IPC/HTTP/WebSocket 完整说明
│   ├── backend-global-state.md       # Rust 全局状态详解
│   └── terminal-system.md            # 终端系统架构（核心重点）
├── features/
│   ├── workspace-management.md       # 工作区 CRUD
│   ├── worktree-lifecycle.md         # 创建→使用→归档→恢复→删除
│   ├── git-operations.md             # sync/merge/PR/diff + 两阶段加载
│   ├── sharing-and-auth.md           # HTTP 分享 + 认证 + 客户端管理
│   ├── ngrok-tunnel.md               # 内网穿透
│   ├── terminal-management.md        # 终端标签/交互/会话管理
│   └── ide-integration.md            # VS Code/Cursor/IDEA
├── api/
│   ├── tauri-commands.md             # 61个命令完整签名和说明
│   ├── http-endpoints.md             # REST API 端点
│   └── websocket-protocol.md         # WS 消息格式
├── development/
│   ├── getting-started.md            # 环境搭建 + 依赖安装
│   ├── code-conventions.md           # TS/Rust/CSS 命名和结构规范
│   └── release-process.md            # 版本号 + 构建 + 发布
└── reference/
    ├── data-types.md                 # 完整 TypeScript/Rust 类型定义
    ├── config-files.md               # 全局配置 + 工作区配置格式
    └── directory-conventions.md      # 目录结构 + symlink 约定
```

#### Obsidian 格式规范

1. **YAML Frontmatter** — 每个文件包含 tags 和 aliases
2. **Wiki Links** — 使用 `[[file]]` 和 `[[file#heading]]` 交叉引用
3. **Callouts** — 用 `> [!warning]` 高亮关键约束，`> [!note]` 补充说明
4. **Tags** — `#architecture`, `#feature`, `#api`, `#core-constraint`
5. **MOC 模式** — CLAUDE.md 作为 Map of Content，分领域索引

#### CLAUDE.md（vault 版 MOC）内容结构

```markdown
# Worktree Manager

一句话描述 + 技术栈

## 架构
- [[architecture/overview]] — 分层架构
- [[architecture/dual-mode-communication]] — 双模式通信
- [[architecture/backend-global-state]] — 后端状态
- [[architecture/terminal-system]] — 终端系统 ⚠️ 核心

## 功能模块  
- [[features/...]] 列表

## API 参考
- [[api/...]] 列表

## 开发指南
- [[development/...]] 列表

## 参考资料
- [[reference/...]] 列表
```

## 内容迁移映射

| 源文件 | 目标 (Vault) | 说明 |
|--------|-------------|------|
| docs/ARCHITECTURE.md 架构分层图 | architecture/overview.md | 保留架构图 |
| docs/ARCHITECTURE.md 通信机制 | architecture/dual-mode-communication.md | 含代码示例 |
| docs/ARCHITECTURE.md 状态管理 | architecture/backend-global-state.md | |
| docs/FEATURES.md 各功能模块 | features/*.md | 一个功能一个文件 |
| docs/API.md Tauri 命令 | api/tauri-commands.md | |
| docs/API.md HTTP 端点 | api/http-endpoints.md | |
| docs/API.md WebSocket | api/websocket-protocol.md | |
| docs/DEVELOPMENT.md 环境搭建 | development/getting-started.md | |
| docs/DEVELOPMENT.md 代码规范 | development/code-conventions.md | |
| docs/DEVELOPMENT.md 发布流程 | development/release-process.md | |
| docs/PROJECT_OVERVIEW.md | architecture/overview.md (合并) | |
| CLAUDE.md 数据类型 | reference/data-types.md | |
| CLAUDE.md 配置文件 | reference/config-files.md | |
| CLAUDE.md 目录约定 | reference/directory-conventions.md | |

## Token 影响预估

| 指标 | 当前 | 优化后 |
|------|------|--------|
| CLAUDE.md 自动加载 | ~190行 / ~3K tokens | ~40行 / ~1K tokens |
| 典型编码任务消耗 | 3K tokens（全量） | 1K + 按需 0.5-1K |
| 节省比例 | — | ~50-67% |

## 实施步骤

1. 创建新 CLAUDE.md（精简版）
2. 创建 docs/claude/ 下 3 个参考文件
3. 在 vault 中创建目录结构和 CLAUDE.md MOC
4. 迁移内容到 vault 各文件
5. 删除 docs/ 下旧文件
6. 验证：运行 npm run contracts 确认不受影响
7. 提交变更
