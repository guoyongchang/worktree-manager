# Worktree Manager 问题修复计划

## 问题概览

- **严重 (Critical)**: 3 个
- **重要 (Important)**: 7 个
- **轻微 (Minor)**: 27+ 个

---

## Phase 1: 严重问题修复 (Critical)

### 1.1 修复 CSP 安全策略
- **文件**: `src-tauri/tauri.conf.json`
- **问题**: `"csp": null` 完全禁用了内容安全策略
- **修复**: 添加适当的 CSP 策略
```json
"csp": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'"
```

### 1.2 修复 PTY 会话内存泄漏
- **文件**: `src-tauri/src/pty_manager.rs`
- **问题**: `close_session` 只从 HashMap 移除，未杀死子进程
- **修复**: 在关闭会话时显式终止子进程

### 1.3 优化终端轮询机制
- **文件**: `src/components/Terminal.tsx`
- **问题**: 50ms 轮询间隔可能导致竞态条件
- **修复**: 增加轮询间隔至 100ms，或使用事件驱动方式

---

## Phase 2: 重要问题修复 (Important)

### 2.1 配置加载错误处理
- **文件**: `src-tauri/src/lib.rs`
- **问题**: 配置解析失败时静默回退
- **修复**: 记录错误日志并通知用户

### 2.2 移除硬编码分支逻辑
- **文件**: `src-tauri/src/git_ops.rs`
- **问题**: 使用路径字符串匹配确定分支
- **修复**: 从配置读取分支信息

### 2.3 修复 State 无限增长
- **文件**: `src/App.tsx`, `src/hooks/useTerminal.ts`
- **问题**: `selectedProjects` 和 `activatedTerminals` 无清理
- **修复**: 在模态框关闭和工作区切换时清理状态

### 2.4 修复 Ref 空检查
- **文件**: `src/components/Terminal.tsx`
- **问题**: 使用 `xtermRef.current!` 无空检查
- **修复**: 添加空值检查

### 2.5 归档时关闭 PTY 会话
- **文件**: `src-tauri/src/lib.rs`
- **问题**: 归档工作区时未关闭关联的终端会话
- **修复**: 在归档前关闭所有相关 PTY 会话

### 2.6 修复 useEffect 依赖数组
- **文件**: 多处
- **问题**: 依赖数组缺失或可能导致无限循环
- **修复**: 使用 useCallback 并正确设置依赖

### 2.7 使用 ResizeObserver 替代 setTimeout
- **文件**: `src/components/Terminal.tsx`
- **问题**: 100ms 延迟可能无法捕获最终尺寸
- **修复**: 使用 ResizeObserver API

---

## Phase 3: 轻微问题修复 (Minor)

### 3.1 代码质量
- [ ] 统一错误处理模式
- [ ] 移除生产环境 console.error
- [ ] 清理死代码 (`open_in_vscode`, `run_terminal_command`)
- [ ] 统一命名规范
- [ ] 提取魔法数字为常量

### 3.2 UI/UX 改进
- [ ] 删除工作区添加确认对话框
- [ ] 添加空状态提示
- [ ] 添加操作反馈 (toast 通知)
- [ ] 添加键盘快捷键 (Cmd+N, Cmd+W 等)

### 3.3 可访问性
- [ ] 添加 ARIA 标签
- [ ] 实现焦点管理

### 3.4 性能优化
- [ ] 使用 React.memo 优化隐藏终端
- [ ] Git 命令添加超时
- [ ] 限制终端缓冲区大小

### 3.5 安全加固
- [ ] 添加 Worktree 名称输入验证

---

## 执行策略

使用多个 subagent 并行处理：

1. **bugfix agent**: 处理 Phase 1 的严重问题
2. **code agent**: 处理 Phase 2 的重要问题
3. **optimize agent**: 处理 Phase 3 的性能和代码质量问题

每个 phase 完成后进行构建验证，确保不引入新问题。

---

## 验收标准

- [ ] 所有 Critical 问题已修复
- [ ] 所有 Important 问题已修复
- [ ] 构建成功无错误
- [ ] 应用正常运行
- [ ] 提交代码并通过检查
