# Command Contracts

`worktree-manager` 需要同时维护三份命令契约来源：

- `src/lib/backend.ts` - 前端调用适配层，以及少量浏览器专用的直接 HTTP 端点
- `src-tauri/src/lib.rs` - Tauri IPC `generate_handler![]` 注册表
- `src-tauri/src/http_server.rs` + `src-tauri/src/http_server/routing.rs` - 浏览器模式 HTTP 路由

## 可用命令

```bash
npm run verify:contracts
npm run docs:contracts
npm run contracts
```

- `verify:contracts` 会检查前端命令、IPC 命令和 HTTP 路由是否保持同步
- `docs:contracts` 会生成当前矩阵文档到 `docs/generated/command-contracts.md`
- `contracts` 会先校验，再刷新文档

## 脚本检查规则

1. `src/` 下所有 `callBackend('command')` 的调用，必须同时存在于 `src-tauri/src/lib.rs` 和 HTTP `/api/{command}` 路由中
2. `src/lib/backend.ts` 中直接使用 `fetch(${getApiBase()}/...)` 的浏览器专用端点，必须存在对应 HTTP 路由
3. 带有 `/` 或 `.` 的 HTTP 路由会被视为基础设施路由，不要求映射到 Tauri IPC
4. 路由扫描会同时读取 `src-tauri/src/http_server.rs` 与拆分后的 `src-tauri/src/http_server/routing.rs`

## 新增命令时的同步步骤

1. 在前端新增 `callBackend('your_command')` 或封装函数
2. 在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![]` 中注册 `your_command`
3. 在 HTTP 路由层增加 `/api/your_command`
4. 运行 `npm run contracts`

如果新增的是浏览器专用 HTTP 端点，请直接在 `src/lib/backend.ts` 中封装对应 `fetch()`，然后运行 `npm run contracts` 确认它被归类为 HTTP-only endpoint。
