# 开发指南

## 项目结构

```
worktree-manager/
├── src/                          # 前端源代码
│   ├── components/               # React 组件
│   │   ├── ui/                   # UI 基础组件 (Radix UI)
│   │   ├── WorktreeSidebar.tsx   # 工作树侧边栏
│   │   ├── WorktreeDetail.tsx    # 工作树详情
│   │   ├── TerminalPanel.tsx     # 终端面板
│   │   ├── Terminal.tsx          # 终端组件
│   │   ├── GitOperations.tsx     # Git 操作组件
│   │   ├── SettingsView.tsx      # 设置视图
│   │   ├── WelcomeView.tsx       # 欢迎视图
│   │   └── ...                   # 其他组件
│   ├── hooks/                    # 自定义 Hooks
│   │   ├── useWorkspace.ts       # 工作区状态管理
│   │   ├── useTerminal.ts        # 终端状态管理
│   │   └── useUpdater.ts         # 更新器状态管理
│   ├── lib/                      # 工具库
│   │   ├── backend.ts            # 后端 API 调用
│   │   ├── websocket.ts          # WebSocket 管理
│   │   └── utils.ts              # 工具函数
│   ├── utils/                    # 工具函数
│   │   └── updater.ts            # 更新器工具
│   ├── App.tsx                   # 主应用组件
│   ├── main.tsx                  # 应用入口
│   ├── types.ts                  # TypeScript 类型定义
│   └── index.css                 # 全局样式
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs               # 应用入口
│   │   ├── lib.rs                # 核心库，Tauri 命令定义
│   │   ├── git_ops.rs            # Git 操作模块
│   │   ├── pty_manager.rs        # 伪终端管理器
│   │   └── http_server.rs        # HTTP 服务器
│   ├── icons/                    # 应用图标
│   ├── Cargo.toml                # Rust 依赖配置
│   └── tauri.conf.json           # Tauri 配置
├── public/                       # 静态资源
├── docs/                         # 项目文档
├── dist/                         # 构建输出（前端）
├── package.json                  # Node.js 依赖配置
├── tsconfig.json                 # TypeScript 配置
├── vite.config.ts                # Vite 配置
├── tailwind.config.js            # Tailwind CSS 配置
└── README.md                     # 项目说明
```

## 关键文件和目录

### 前端关键文件

#### `src/App.tsx`
主应用组件，包含：
- 应用状态管理
- 路由和视图切换
- 模态框管理
- 分享功能 UI
- 客户端管理 UI
- NGROK UI

#### `src/components/WorktreeSidebar.tsx`
工作树侧边栏组件，显示：
- 工作区列表
- 工作树列表
- 创建工作树按钮
- 归档工作树列表

#### `src/components/WorktreeDetail.tsx`
工作树详情组件，显示：
- 项目列表和状态
- Git 操作按钮
- IDE 打开按钮
- 项目详细信息

#### `src/components/GitOperations.tsx`
Git 操作组件，提供：
- 同步基础分支
- 合并到测试分支
- 创建 Pull Request
- 查看分支差异

#### `src/components/TerminalPanel.tsx`
终端面板组件，管理：
- 终端标签页
- 终端实例
- 终端全屏模式

#### `src/hooks/useWorkspace.ts`
工作区状态管理 Hook，负责：
- 加载工作区列表
- 切换工作区
- 加载工作树列表
- 刷新工作区状态

#### `src/lib/backend.ts`
后端 API 调用封装，提供：
- Tauri IPC 调用（桌面模式）
- HTTP API 调用（浏览器模式）
- 统一的 API 接口

### 后端关键文件

#### `src-tauri/src/lib.rs`
核心库文件，包含：
- 全局状态定义
- Tauri 命令实现
- 工作区管理逻辑
- 工作树操作逻辑
- 分享功能实现
- NGROK 集成

#### `src-tauri/src/git_ops.rs`
Git 操作模块，提供：
- `get_worktree_info`：获取工作树信息
- `get_branch_status`：获取分支状态
- Git 命令执行封装

#### `src-tauri/src/pty_manager.rs`
伪终端管理器，负责：
- 创建和管理伪终端实例
- 处理终端输入/输出
- 调整终端大小
- 关闭终端

#### `src-tauri/src/http_server.rs`
HTTP 服务器，提供：
- REST API 端点
- WebSocket 支持
- 静态文件服务
- 认证和会话管理

### 配置文件

#### `package.json`
Node.js 项目配置，定义：
- 项目元信息
- 依赖包
- 脚本命令

#### `src-tauri/Cargo.toml`
Rust 项目配置，定义：
- 项目元信息
- Rust 依赖
- 构建配置

#### `src-tauri/tauri.conf.json`
Tauri 配置文件，定义：
- 应用标识符
- 窗口配置
- 权限配置
- 更新器配置
- 构建配置

#### `vite.config.ts`
Vite 构建配置，定义：
- 插件配置
- 构建选项
- 开发服务器配置

#### `tailwind.config.js`
Tailwind CSS 配置，定义：
- 主题配置
- 插件配置
- 内容路径

## 开发环境设置

### 系统要求

- **Node.js**: 20.x 或更高版本
- **Rust**: 1.70 或更高版本
- **Git**: 2.0 或更高版本
- **操作系统**: macOS, Linux, 或 Windows

### 安装依赖

#### 1. 安装 Rust

```bash
# macOS/Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows
# 下载并运行 https://rustup.rs
```

#### 2. 安装 Node.js

```bash
# 使用 nvm (推荐)
nvm install 20
nvm use 20

# 或直接从 https://nodejs.org 下载安装
```

#### 3. 克隆项目

```bash
git clone https://github.com/guoyongchang/worktree-manager.git
cd worktree-manager
```

#### 4. 安装前端依赖

```bash
npm install
```

#### 5. 安装 Rust 依赖

```bash
cd src-tauri
cargo build
cd ..
```

### 开发工具推荐

- **IDE**: Visual Studio Code 或 Cursor
- **VS Code 扩展**:
  - Rust Analyzer
  - Tauri
  - ESLint
  - Prettier
  - Tailwind CSS IntelliSense

## 构建和运行

### 开发模式

#### 启动开发服务器

```bash
npm run tauri dev
```

这会：
1. 启动 Vite 开发服务器（前端）
2. 编译 Rust 代码（后端）
3. 启动 Tauri 应用

#### 热重载

- **前端**：Vite 自动热重载
- **后端**：修改 Rust 代码后需要重启应用

### 生产构建

#### 构建应用

```bash
npm run tauri build
```

这会：
1. 构建前端（生产模式）
2. 编译 Rust 代码（release 模式）
3. 打包应用（生成安装包）

#### 构建输出

- **macOS**: `src-tauri/target/release/bundle/dmg/`
- **Linux**: `src-tauri/target/release/bundle/deb/` 或 `appimage/`
- **Windows**: `src-tauri/target/release/bundle/msi/`

### 仅构建前端

```bash
npm run build
```

输出到 `dist/` 目录。

### 预览构建

```bash
npm run preview
```

启动本地服务器预览构建后的前端。

## 代码规范

### TypeScript/React 规范

#### 命名规范

- **组件**：PascalCase（如 `WorktreeSidebar`）
- **函数**：camelCase（如 `handleClick`）
- **常量**：UPPER_SNAKE_CASE（如 `API_BASE_URL`）
- **类型/接口**：PascalCase（如 `WorkspaceConfig`）

#### 组件结构

```typescript
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import type { WorktreeListItem } from '@/types';

interface MyComponentProps {
  worktree: WorktreeListItem;
  onSelect: (worktree: WorktreeListItem) => void;
}

export const MyComponent: FC<MyComponentProps> = ({ worktree, onSelect }) => {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 副作用逻辑
  }, [worktree]);

  const handleClick = () => {
    setLoading(true);
    onSelect(worktree);
    setLoading(false);
  };

  return (
    <div>
      <Button onClick={handleClick} disabled={loading}>
        {loading ? 'Loading...' : 'Select'}
      </Button>
    </div>
  );
};
```

#### 类型定义

- 优先使用 `interface` 而非 `type`
- 导出所有公共类型
- 使用 `types.ts` 集中管理类型

### Rust 规范

#### 命名规范

- **函数**：snake_case（如 `create_worktree`）
- **类型/结构体**：PascalCase（如 `WorkspaceConfig`）
- **常量**：UPPER_SNAKE_CASE（如 `MAX_RETRIES`）
- **模块**：snake_case（如 `git_ops`）

#### 错误处理

```rust
// 使用 Result 类型
fn do_something() -> Result<String, String> {
    // 使用 ? 操作符传播错误
    let value = some_operation()
        .map_err(|e| format!("Operation failed: {}", e))?;

    Ok(value)
}

// Tauri 命令
#[tauri::command]
async fn my_command(param: String) -> Result<String, String> {
    do_something()
}
```

#### 异步代码

```rust
// 使用 async/await
#[tauri::command]
async fn async_operation() -> Result<String, String> {
    let result = tokio::spawn(async {
        // 异步操作
    }).await
        .map_err(|e| format!("Task failed: {}", e))?;

    Ok(result)
}
```

### 样式规范

#### Tailwind CSS

- 使用 Tailwind 实用类
- 避免自定义 CSS（除非必要）
- 使用 `@apply` 提取重复样式

```tsx
// 好的做法
<div className="flex items-center gap-2 p-4 bg-gray-100 rounded-lg">
  <Button className="px-4 py-2 bg-blue-500 text-white">
    Click me
  </Button>
</div>

// 避免
<div style={{ display: 'flex', padding: '16px' }}>
  <button style={{ background: 'blue' }}>Click me</button>
</div>
```

### Git 提交规范

#### 提交消息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

#### 类型 (type)

- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试
- `chore`: 构建/工具链

#### 示例

```
feat(git): 添加同步基础分支功能

- 实现 sync_with_base_branch 命令
- 添加 GitOperations 组件
- 更新 UI 显示同步状态

Closes #123
```

## 调试技巧

### 前端调试

#### 浏览器开发者工具

```typescript
// 使用 console.log
console.log('Debug info:', data);

// 使用 debugger
debugger;
```

#### React DevTools

安装 React DevTools 浏览器扩展，查看组件树和状态。

### 后端调试

#### 日志输出

```rust
use log::{info, warn, error, debug};

#[tauri::command]
fn my_command() -> Result<(), String> {
    info!("Command started");
    debug!("Debug info: {:?}", data);
    warn!("Warning message");
    error!("Error occurred");

    Ok(())
}
```

#### Rust 调试器

使用 `rust-lldb` 或 `rust-gdb` 进行调试。

### Tauri 调试

#### 打开开发者工具

在开发模式下，按 `Cmd+Option+I` (macOS) 或 `Ctrl+Shift+I` (Windows/Linux) 打开开发者工具。

#### 查看 Tauri 日志

```bash
# macOS
tail -f ~/Library/Logs/worktree-manager/worktree-manager.log

# Linux
tail -f ~/.local/share/worktree-manager/logs/worktree-manager.log

# Windows
type %APPDATA%\worktree-manager\logs\worktree-manager.log
```

## 测试

### 前端测试

```bash
# 运行测试（未来功能）
npm test

# 运行测试覆盖率
npm run test:coverage
```

### 后端测试

```bash
cd src-tauri
cargo test
```

### 集成测试

```bash
# 运行端到端测试（未来功能）
npm run test:e2e
```

## 常见问题

### 1. Rust 编译错误

**问题**: `error: linking with 'cc' failed`

**解决**:
```bash
# macOS
xcode-select --install

# Linux
sudo apt-get install build-essential

# Windows
# 安装 Visual Studio Build Tools
```

### 2. Node.js 版本不兼容

**问题**: `error: Unsupported Node.js version`

**解决**:
```bash
nvm install 20
nvm use 20
```

### 3. Tauri 构建失败

**问题**: `error: failed to run custom build command for 'tauri'`

**解决**:
```bash
# 清理缓存
cd src-tauri
cargo clean
cd ..
npm run tauri build
```

### 4. WebSocket 连接失败

**问题**: 浏览器模式下 WebSocket 无法连接

**解决**:
- 检查防火墙设置
- 确认端口未被占用
- 检查 CORS 配置

### 5. Git 操作失败

**问题**: Git 命令执行失败

**解决**:
- 确认 Git 已安装
- 检查 Git 配置
- 确认仓库状态正常

## 性能优化

### 前端优化

1. **代码分割**: 使用动态导入
2. **懒加载**: 延迟加载非关键组件
3. **虚拟滚动**: 处理大量数据
4. **防抖和节流**: 优化频繁触发的事件

### 后端优化

1. **异步 I/O**: 使用 Tokio 异步运行时
2. **连接池**: 复用数据库/网络连接
3. **缓存**: 缓存频繁访问的数据
4. **批量操作**: 减少系统调用次数

## 发布流程

### 1. 更新版本号

```bash
# 更新 package.json
npm version patch  # 或 minor, major

# 更新 src-tauri/Cargo.toml
# 手动修改 version 字段

# 更新 src-tauri/tauri.conf.json
# 手动修改 version 字段
```

### 2. 构建应用

```bash
npm run tauri build
```

### 3. 测试安装包

在目标平台上测试生成的安装包。

### 4. 创建 Git 标签

```bash
git tag -a v0.1.1 -m "Release v0.1.1"
git push origin v0.1.1
```

### 5. 发布到 GitHub

1. 在 GitHub 创建 Release
2. 上传安装包
3. 编写 Release Notes

### 6. 更新文档

更新 README.md 和相关文档。

## 贡献指南

### 提交 Pull Request

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 代码审查

- 确保代码符合规范
- 添加必要的测试
- 更新相关文档
- 通过 CI 检查

## 资源链接

- [Tauri 文档](https://tauri.app/v2/guides/)
- [React 文档](https://react.dev/)
- [Rust 文档](https://doc.rust-lang.org/)
- [Vite 文档](https://vitejs.dev/)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [Radix UI 文档](https://www.radix-ui.com/docs/primitives)
